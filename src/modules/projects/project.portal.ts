import type { PortalContext } from "@/server/context";
import type { Project } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import * as production from "./production.repository";
import * as repository from "./project.repository";

/**
 * Lectures du projet vues du portail client : ce fichier est le seul chemin vers ces tables pour
 * `src/modules/portal`. Le filtre sur `companyId` est dans chaque lecture, et rien d'interne n'en
 * sort : ni statut interne, ni budget consommé, ni tâche, ni blocage, ni coût, ni tarif.
 */
export type PortalReadScope = Pick<PortalContext, "db" | "companyId">;

/** Où en est le projet, en mots de client. `blocked` et `in_validation` restent internes. */
export type PortalProjectStage = "starting" | "ongoing" | "delivered" | "closed";

function stageOf(status: Project["status"]): PortalProjectStage {
  if (status === "preparation") return "starting";
  if (status === "delivered") return "delivered";
  if (status === "closed") return "closed";
  return "ongoing";
}

export interface PortalProjectSummary {
  id: string;
  number: string;
  name: string;
  stage: PortalProjectStage;
  startOn: string | null;
  dueOn: string | null;
  deliveredOn: string | null;
}

/** Projets du client connecté, les plus récents d'abord. */
export async function listProjectsForPortal(
  scope: PortalReadScope,
  options: { limit?: number } = {},
): Promise<PortalProjectSummary[]> {
  const rows = await repository.listProjectsOfCompany(scope.db, {
    companyId: scope.companyId,
    projectIds: null,
    limit: Math.min(options.limit ?? 50, 200),
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    name: row.name,
    stage: stageOf(row.status),
    startOn: row.startOn,
    dueOn: row.dueOn,
    deliveredOn: row.deliveredOn,
  }));
}

export interface PortalPhase {
  id: string;
  name: string;
  state: "done" | "current" | "todo";
  dueOn: string | null;
  doneOn: Date | null;
}

export interface PortalDeliverable {
  id: string;
  title: string;
  /** `draft` n'est jamais renvoyé : un brouillon n'existe pas pour le client. */
  status: "to_validate" | "validated" | "changes_requested";
  version: number;
  documentId: string | null;
  updatedAt: Date;
  feedbackRoundsIncluded: number;
  feedbackRoundsUsed: number;
  /** Date de la décision du client sur la version courante. */
  decidedAt: Date | null;
}

export interface PortalRequirement {
  id: string;
  label: string;
  status: "expected" | "received";
  dueOn: string | null;
  receivedAt: Date | null;
  documentId: string | null;
}

/** Interlocuteur affiché au client : un nom et un intitulé, jamais un tarif ni un contact privé. */
export interface PortalInterlocutor {
  id: string;
  fullName: string;
  title: string | null;
}

export interface PortalProjectDetail extends PortalProjectSummary {
  /** Étape affichée à côté de l'avancement. */
  stepLabel: string | null;
  /** Montant vendu HT, connu du client : ce n'est ni un coût ni une marge. */
  soldCents: number | null;
  phases: PortalPhase[];
  deliverables: PortalDeliverable[];
  requirements: PortalRequirement[];
  interlocutors: PortalInterlocutor[];
}

const toPhaseState = (status: string): PortalPhase["state"] =>
  status === "done" ? "done" : status === "in_progress" ? "current" : "todo";

/** Le responsable d'abord, puis l'équipe du projet. Les prestataires restent ceux de l'agence. */
function interlocutorsOf(
  project: Project,
  ownerName: string | null,
  members: readonly repository.ProjectMemberRow[],
): PortalInterlocutor[] {
  const owner =
    project.ownerMemberId && ownerName
      ? [{ id: project.ownerMemberId, fullName: ownerName, title: null }]
      : [];
  const team = members
    .filter((member) => member.kind !== "contractor" && member.memberId !== project.ownerMemberId)
    .map((member) => ({ id: member.memberId, fullName: member.fullName, title: member.title }));
  return [...owner, ...team];
}

/**
 * Fiche d'un projet pour le portail. Le projet d'un autre client, ou un projet archivé, répond comme
 * s'il n'existait pas : aucune lecture n'a lieu avant ce contrôle.
 */
export async function getProjectForPortal(
  scope: PortalReadScope,
  projectId: string,
): Promise<PortalProjectDetail> {
  const header = await repository.findProjectHeader(scope.db, projectId);
  if (!header || header.project.companyId !== scope.companyId || header.project.archivedAt) {
    throw new NotFoundError("Projet introuvable.");
  }
  const { project } = header;

  const [phases, deliverables, requirements, members] = await Promise.all([
    production.listPhases(scope.db, project.id),
    production.listDeliverables(scope.db, project.id),
    production.listRequirements(scope.db, project.id),
    repository.membersByProject(scope.db, [project.id]),
  ]);

  const shared = deliverables.filter(
    (item) => item.requiresClientValidation && item.status !== "draft",
  );
  const reviews = await production.reviewsByDeliverable(
    scope.db,
    shared.map((item) => item.id),
  );

  return {
    id: project.id,
    number: project.number,
    name: project.name,
    stage: stageOf(project.status),
    startOn: project.startOn,
    dueOn: project.dueOn,
    deliveredOn: project.deliveredOn,
    stepLabel: project.clientStepLabel,
    soldCents: project.budgetCents,
    phases: phases
      .filter((phase) => phase.clientVisible)
      .map((phase) => ({
        id: phase.id,
        name: phase.name,
        state: toPhaseState(phase.status),
        dueOn: phase.dueOn,
        doneOn: phase.status === "done" ? phase.updatedAt : null,
      })),
    deliverables: shared.map((item) => {
      const rows = reviews.get(item.id) ?? [];
      return {
        id: item.id,
        title: item.title,
        status: item.status as PortalDeliverable["status"],
        version: item.version,
        documentId: item.documentId,
        updatedAt: item.updatedAt,
        feedbackRoundsIncluded: item.feedbackRoundsIncluded,
        feedbackRoundsUsed: rows.filter((row) => row.decision === "changes_requested").length,
        decidedAt: rows.find((row) => row.version === item.version)?.at ?? null,
      };
    }),
    requirements: requirements.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      dueOn: item.dueOn,
      receivedAt: item.receivedAt,
      documentId: item.documentId,
    })),
    interlocutors: interlocutorsOf(project, header.ownerName, members.get(project.id) ?? []),
  };
}
