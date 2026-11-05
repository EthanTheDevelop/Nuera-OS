import { OFFER_ACTIVITY_LABELS, type Priority, type ProjectStatus } from "@/lib/domain-enums";
import { AUDIT_ACTIONS, type AuditAction } from "@/modules/audit/audit.constants";
import { recordAudit } from "@/modules/audit/audit.service";
import { emitEvent } from "@/modules/platform/events";
import { nextNumber } from "@/modules/platform/sequences";
import { listDocumentsFor } from "@/modules/documents/document.service";
import { activateSiteAfterGoLive } from "@/modules/sites/site.service";
import {
  getMemberIdForUser,
  listAssignableMembers,
  type MemberOption,
} from "@/modules/team/team.lookup";
import { getSixWeekLoad, type WeekLoad } from "@/modules/time/capacity.service";
import { getMargin, type MarginBreakdown } from "@/modules/finance/profitability.service";
import { assertCan, assertCanAny, can } from "@/server/auth/permissions";
import { logger } from "@/server/logger";
import type { ServiceContext } from "@/server/context";
import type { Project, ProjectPhase } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import {
  assertProjectEditable,
  lockExistingProject,
  requireReadableProject,
  resolveProjectScope,
} from "./project.access";
import * as repository from "./project.repository";
import {
  addDays,
  budgetConsumption,
  daysBetween,
  EMPTY_TASK_TOTALS,
  offerLabel,
  parseChecklistItems,
  parisDay,
  parsePlanItems,
  standardHandover,
  plannedMinutesToDate,
  projectHealth,
  projectProgress,
  projectTitle,
  standardPlan,
  type PlanPhase,
  type ProjectHealth,
  type ProjectProgress,
} from "./project.rules";
import {
  changeProjectStatusSchema,
  companyRowsSchema,
  createProjectFromQuoteSchema,
  createProjectSchema,
  goLiveSchema,
  projectListSchema,
  projectMemberSchema,
  removeProjectMemberSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type GoLiveInput,
  type ProjectListInput,
  type UpdateProjectInput,
} from "./project.schema";
import {
  assertProjectTransition,
  canProjectTransition,
  PROJECT_STATUS_LABELS,
  PROJECT_TRANSITIONS,
} from "./project.status";
import * as production from "./production.repository";
import * as taskRepository from "./task.repository";

// Le portail, les automatisations et la fiche client n'ont qu'une porte d'entrée à connaître.
export {
  listChangeRequestsForCompany,
  markRequirementReceived,
  recordDeliverableReview,
  submitDeliverable,
  createChangeRequest,
} from "./production.service";
export { listOverdueTasks } from "./task.service";

// --- Création ----------------------------------------------------------------------------------

export interface CreateProjectFromQuoteInput {
  quoteId: string;
  /** NULL : devis sans affaire d'origine. */
  opportunityId: string | null;
  companyId: string;
  /** Version acceptée du devis, source du périmètre et du budget. */
  versionId: string;
}

/** Jalons, tâches initiales et points de passation d'un nouveau projet, d'après les modèles. */
async function seedProjectPlan(
  tx: Database,
  project: Project,
  options: { now: Date },
): Promise<{ plan: PlanPhase[] }> {
  const planItems = await repository.findTemplateItems(tx, "project_plan", project.activity);
  const plan = (planItems ? parsePlanItems(planItems) : null) ?? standardPlan();

  const phases = await production.insertPhases(
    tx,
    plan.map((phase, index) => ({
      projectId: project.id,
      name: phase.name,
      position: index + 1,
      clientVisible: phase.clientVisible,
      dueOn:
        phase.dueOffsetDays !== null && project.startOn
          ? addDays(project.startOn, phase.dueOffsetDays)
          : null,
    })),
  );
  const phaseByPosition = new Map(phases.map((phase) => [phase.position, phase.id]));

  let position = 0;
  for (const [index, phase] of plan.entries()) {
    for (const task of phase.tasks) {
      position += 1;
      await taskRepository.insertTask(tx, {
        number: await nextNumber(tx, "task", options.now),
        projectId: project.id,
        phaseId: phaseByPosition.get(index + 1) ?? null,
        title: task.title,
        description: task.description,
        estimatedMinutes: task.estimatedMinutes,
        position,
      });
    }
  }

  const checklistItems = await repository.findTemplateItems(tx, "checklist", project.activity);
  await production.insertHandoverItems(
    tx,
    (checklistItems ? parseChecklistItems(checklistItems) : standardHandover()).map(
      (label, index) => ({
        projectId: project.id,
        label,
        position: index + 1,
      }),
    ),
  );

  return { plan };
}

/**
 * Crée le projet d'un devis accepté. Idempotent par `quoteId` (index unique partiel) : une seconde
 * exécution renvoie le projet existant. S'exécute dans la transaction du devis : si l'acceptation
 * échoue, le projet n'existe pas.
 */
export async function createProjectFromQuote(
  ctx: ServiceContext,
  tx: Database,
  input: CreateProjectFromQuoteInput,
): Promise<Project> {
  assertCanAny(ctx.actor, ["projects:create", "quotes:update"]);
  const parsed = parseInput(createProjectFromQuoteSchema, input);

  const existing = await repository.findProjectByQuote(tx, parsed.quoteId);
  if (existing) return existing;

  const source = await repository.findQuoteSource(tx, parsed);
  if (!source || source.versionQuoteId !== parsed.quoteId) {
    throw new NotFoundError("Devis introuvable.");
  }
  if (source.companyId !== parsed.companyId) {
    throw new ConflictError("Ce devis appartient à un autre client.");
  }
  if (source.status !== "accepted") {
    throw new ConflictError("Seul un devis accepté donne un projet.");
  }

  const now = new Date();
  const today = parisDay(now);
  const activity = await repository.findQuoteActivity(tx, parsed.versionId);
  const ownerMemberId =
    (parsed.opportunityId
      ? await repository.findOpportunityOwner(tx, parsed.opportunityId)
      : null) ?? (await getMemberIdForUser(tx, ctx.actor.userId));

  const project = await repository.insertProjectFromQuote(tx, {
    number: await nextNumber(tx, "project", now),
    companyId: parsed.companyId,
    opportunityId: parsed.opportunityId,
    quoteId: parsed.quoteId,
    name: source.title ?? source.number,
    activity,
    scope: source.scope,
    ownerMemberId,
    startOn: today,
    budgetCents: source.totalCents,
    estimatedMinutes: source.estimatedMinutes,
  });
  if (!project) {
    // Une exécution concurrente vient de le créer : même réponse qu'une répétition.
    const concurrent = await repository.findProjectByQuote(tx, parsed.quoteId);
    if (!concurrent) throw new ConflictError("Le projet de ce devis n'a pas pu être créé.");
    return concurrent;
  }

  const { plan } = await seedProjectPlan(tx, project, { now });
  if (ownerMemberId) {
    await production.insertProjectMember(tx, { projectId: project.id, memberId: ownerMemberId });
  }
  await recordAudit(tx, {
    actorId: ctx.actor.userId,
    action: "project.created",
    entityType: "project",
    entityId: project.id,
    metadata: {
      number: project.number,
      quoteId: parsed.quoteId,
      versionId: parsed.versionId,
      phases: plan.length,
    },
  });
  await emitEvent(tx, {
    type: "project.created",
    entityType: "project",
    entityId: project.id,
    companyId: project.companyId,
    payload: { number: project.number, name: project.name, quoteId: parsed.quoteId },
    actorId: ctx.actor.userId,
    dedupeKey: `project.created:${project.id}`,
  });
  return project;
}

function assertDatesInOrder(startOn: string | null | undefined, dueOn: string | null | undefined) {
  if (startOn && dueOn && dueOn < startOn) {
    throw new ValidationError("La mise en ligne ne peut pas précéder le début.", {
      dueOn: ["La mise en ligne ne peut pas précéder le début."],
    });
  }
}

async function assertAssignable(db: Database, memberId: string | null | undefined, field: string) {
  if (!memberId) return;
  const member = await repository.findActiveMember(db, memberId);
  if (!member) {
    throw new ValidationError("Cette personne n'est plus disponible.", {
      [field]: ["Cette personne n'est plus disponible."],
    });
  }
}

/** Création manuelle : un projet sans devis d'origine, avec le même plan qu'un projet signé. */
export async function createProject(
  ctx: ServiceContext,
  input: CreateProjectInput,
): Promise<Project> {
  assertCan(ctx.actor, "projects:create");
  const parsed = parseInput(createProjectSchema, input);
  assertDatesInOrder(parsed.startOn, parsed.dueOn);
  if (!(await repository.companyExists(ctx.db, parsed.companyId))) {
    throw new ValidationError("Ce client n'existe pas.", {
      companyId: ["Ce client n'existe pas."],
    });
  }
  await assertAssignable(ctx.db, parsed.ownerMemberId, "ownerMemberId");

  return ctx.db.transaction(async (tx) => {
    const now = new Date();
    const project = await repository.insertProject(tx, {
      number: await nextNumber(tx, "project", now),
      companyId: parsed.companyId,
      name: parsed.name,
      activity: parsed.activity ?? null,
      objective: parsed.objective ?? null,
      scope: parsed.scope ?? null,
      priority: parsed.priority,
      ownerMemberId: parsed.ownerMemberId ?? null,
      startOn: parsed.startOn ?? null,
      dueOn: parsed.dueOn ?? null,
      budgetCents: parsed.budgetCents ?? null,
      estimatedMinutes: parsed.estimatedMinutes ?? null,
    });
    const { plan } = await seedProjectPlan(tx, project, { now });
    if (project.ownerMemberId) {
      await production.insertProjectMember(tx, {
        projectId: project.id,
        memberId: project.ownerMemberId,
      });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      metadata: { number: project.number, phases: plan.length },
    });
    await emitEvent(tx, {
      type: "project.created",
      entityType: "project",
      entityId: project.id,
      companyId: project.companyId,
      payload: { number: project.number, name: project.name, quoteId: null },
      actorId: ctx.actor.userId,
      dedupeKey: `project.created:${project.id}`,
    });
    return project;
  });
}

export async function updateProject(
  ctx: ServiceContext,
  input: UpdateProjectInput,
): Promise<Project> {
  assertCan(ctx.actor, "projects:update");
  const { projectId, ...parsed } = parseInput(updateProjectSchema, input);
  const project = await requireReadableProject(ctx, projectId);
  assertProjectEditable(project);
  assertDatesInOrder(parsed.startOn, parsed.dueOn);
  await assertAssignable(ctx.db, parsed.ownerMemberId, "ownerMemberId");

  return ctx.db.transaction(async (tx) => {
    const updated = await repository.updateProject(tx, projectId, {
      name: parsed.name,
      activity: parsed.activity ?? null,
      objective: parsed.objective ?? null,
      scope: parsed.scope ?? null,
      priority: parsed.priority,
      ownerMemberId: parsed.ownerMemberId ?? null,
      startOn: parsed.startOn ?? null,
      dueOn: parsed.dueOn ?? null,
      budgetCents: parsed.budgetCents ?? null,
      estimatedMinutes: parsed.estimatedMinutes ?? null,
    });
    if (updated.ownerMemberId) {
      await production.insertProjectMember(tx, {
        projectId,
        memberId: updated.ownerMemberId,
      });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project.updated",
      entityType: "project",
      entityId: projectId,
      metadata: { number: updated.number },
    });
    // Réduire l'enveloppe peut franchir le seuil sans nouvelle saisie de temps.
    await checkProjectBudget(tx, projectId, { actorId: ctx.actor.userId });
    return updated;
  });
}

// --- Statuts -----------------------------------------------------------------------------------

async function assertDeliverable(tx: Database, project: Project): Promise<void> {
  assertProjectTransition(project.status, "delivered");
  const blockers = await production.countOpenBlockers(tx, project.id);
  if (blockers > 0) {
    throw new ConflictError("Un blocage reste ouvert : levez-le avant de livrer le projet.");
  }
  const pending = await production.listUnvalidatedClientDeliverables(tx, project.id);
  if (pending.length > 0) {
    throw new ConflictError(
      `Validation client en attente : ${pending.join(", ")}. Le projet ne peut pas être livré.`,
    );
  }
}

/**
 * Avenant signé : le budget et le temps prévus du projet du devis d'origine augmentent d'autant,
 * une seule fois par devis (clé d'événement, dans la transaction de l'acceptation). Rien si l'avenant
 * vient d'une demande dont l'acceptation les a déjà augmentés. Un projet clôturé ou archivé compte
 * aussi : c'est de la comptabilité du vendu, pas une modification du projet.
 */
export async function raiseProjectBudgetFromAmendment(
  ctx: ServiceContext,
  tx: Database,
  input: {
    quoteId: string;
    parentQuoteId: string;
    versionId: string;
    companyId: string;
    auditActorId: string | null;
  },
): Promise<Project | null> {
  assertCanAny(ctx.actor, ["projects:create", "quotes:update"]);
  const origin = await repository.findProjectByQuote(tx, input.parentQuoteId);
  if (!origin) return null;
  const project = await lockExistingProject(tx, origin.id);

  const changeRequest = await production.findChangeRequestOfQuote(tx, input.quoteId);
  if (changeRequest?.budgetAppliedAt) return project;

  const source = await repository.findQuoteSource(tx, {
    quoteId: input.quoteId,
    versionId: input.versionId,
  });
  if (!source || source.versionQuoteId !== input.quoteId) {
    throw new NotFoundError("Devis introuvable.");
  }
  const amountCents = source.totalCents ?? 0;
  const minutes = source.estimatedMinutes ?? 0;
  if (amountCents === 0 && minutes === 0) return project;

  const first = await emitEvent(tx, {
    type: "project.budget_raised",
    entityType: "project",
    entityId: project.id,
    companyId: input.companyId,
    payload: { quoteId: input.quoteId, amountCents, minutes },
    actorId: input.auditActorId,
    dedupeKey: `project.budget_raised:${input.quoteId}`,
  });
  if (!first) return project;

  const updated = await repository.updateProject(tx, project.id, {
    budgetCents: (project.budgetCents ?? 0) + amountCents || null,
    estimatedMinutes: (project.estimatedMinutes ?? 0) + minutes || null,
  });
  await recordAudit(tx, {
    actorId: input.auditActorId,
    action: "project.budget_raised",
    entityType: "project",
    entityId: project.id,
    metadata: {
      quoteId: input.quoteId,
      amountCents,
      minutes,
      fromBudgetCents: project.budgetCents,
      toBudgetCents: updated.budgetCents,
      fromEstimatedMinutes: project.estimatedMinutes,
      toEstimatedMinutes: updated.estimatedMinutes,
    },
  });
  return updated;
}

/** Passage à « Livré » : statut, date, jalons, journal et événements, dans la transaction reçue. */
async function deliverProject(
  ctx: ServiceContext,
  tx: Database,
  project: Project,
  siteId: string | null,
): Promise<Project> {
  await assertDeliverable(tx, project);
  const deliveredOn = parisDay();
  const phases = await production.listPhases(tx, project.id);
  await production.completeOpenPhases(tx, project.id);
  const delivered = await repository.updateProject(tx, project.id, {
    status: "delivered",
    deliveredOn,
    clientStepLabel: phases[phases.length - 1]?.name ?? project.clientStepLabel,
  });
  await recordAudit(tx, {
    actorId: ctx.actor.userId,
    action: "project.delivered",
    entityType: "project",
    entityId: project.id,
    metadata: { number: project.number, from: project.status, deliveredOn, siteId },
  });
  await emitEvent(tx, {
    type: "project.status_changed",
    entityType: "project",
    entityId: project.id,
    companyId: project.companyId,
    payload: { fromStatus: project.status, toStatus: "delivered" },
    actorId: ctx.actor.userId,
  });
  await emitEvent(tx, {
    type: "project.delivered",
    entityType: "project",
    entityId: project.id,
    companyId: project.companyId,
    payload: { number: project.number, deliveredOn },
    actorId: ctx.actor.userId,
    dedupeKey: `project.delivered:${project.id}`,
  });
  if (siteId) await activateSiteAfterGoLive(ctx, tx, { projectId: project.id, siteId });
  return delivered;
}

/** Change le statut selon la machine ; toute transition interdite lève une `ConflictError`. */
export async function changeProjectStatus(
  ctx: ServiceContext,
  input: { projectId: string; status: ProjectStatus },
): Promise<Project> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(changeProjectStatusSchema, input);
  await requireReadableProject(ctx, parsed.projectId);

  return ctx.db.transaction(async (tx) => {
    const project = await lockExistingProject(tx, parsed.projectId);
    if (project.archivedAt) {
      throw new ConflictError("Ce projet est archivé : restaurez-le pour le modifier.");
    }
    if (project.status === parsed.status) return project;

    if (parsed.status === "delivered") {
      const sites = await repository.listSitesOfProject(tx, project.id);
      if (sites.length > 0) {
        throw new ConflictError(
          "Ce projet a un site : passez par la mise en ligne pour le livrer.",
        );
      }
      return deliverProject(ctx, tx, project, null);
    }

    assertProjectTransition(project.status, parsed.status);
    if (parsed.status === "closed") {
      const open = await repository.countOpenHandover(tx, project.id);
      if (open > 0) {
        throw new ConflictError(
          `La passation n'est pas terminée : ${open} point${open > 1 ? "s" : ""} à valider avant la clôture.`,
        );
      }
    }

    const startsNow = project.status === "preparation" && parsed.status === "active";
    let clientStepLabel = project.clientStepLabel;
    if (startsNow) {
      // Démarrer le projet éclaire le premier jalon.
      const phases = await production.listPhases(tx, project.id);
      const first = phases.find((phase) => phase.status === "todo");
      if (first && !phases.some((phase) => phase.status === "in_progress")) {
        await production.updatePhase(tx, first.id, { status: "in_progress" });
        clientStepLabel = first.name;
      }
    }
    const updated = await repository.updateProject(tx, project.id, {
      status: parsed.status,
      clientStepLabel,
      startOn: startsNow ? (project.startOn ?? parisDay()) : project.startOn,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: parsed.status === "closed" ? "project.closed" : "project.status_changed",
      entityType: "project",
      entityId: project.id,
      metadata: { number: project.number, from: project.status, to: parsed.status },
    });
    await emitEvent(tx, {
      type: "project.status_changed",
      entityType: "project",
      entityId: project.id,
      companyId: project.companyId,
      payload: { fromStatus: project.status, toStatus: parsed.status },
      actorId: ctx.actor.userId,
    });
    return updated;
  });
}

/**
 * Mise en ligne : le projet passe à « Livré » et son site est activé, tout ou rien. Si le site ne
 * peut pas être activé, le projet reste en validation. Répéter sur un projet livré ne fait rien.
 */
export async function goLiveProject(ctx: ServiceContext, input: GoLiveInput): Promise<Project> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(goLiveSchema, input);
  await requireReadableProject(ctx, parsed.projectId);

  return ctx.db.transaction(async (tx) => {
    const project = await lockExistingProject(tx, parsed.projectId);
    if (project.archivedAt) {
      throw new ConflictError("Ce projet est archivé : restaurez-le pour le modifier.");
    }
    if (project.status === "delivered") return project;

    const sites = await repository.listSitesOfProject(tx, project.id);
    let siteId = parsed.siteId ?? null;
    if (siteId && !sites.some((site) => site.id === siteId)) {
      throw new NotFoundError("Ce site n'est pas rattaché à ce projet.");
    }
    if (!siteId && sites.length === 1) siteId = sites[0]?.id ?? null;
    if (!siteId && sites.length > 1) {
      throw new ValidationError("Choisissez le site à mettre en ligne.", {
        siteId: ["Choisissez le site à mettre en ligne."],
      });
    }
    return deliverProject(ctx, tx, project, siteId);
  });
}

export async function archiveProject(ctx: ServiceContext, projectId: string): Promise<Project> {
  assertCan(ctx.actor, "projects:archive");
  await requireReadableProject(ctx, projectId);
  return ctx.db.transaction(async (tx) => {
    const project = await lockExistingProject(tx, projectId);
    if (project.archivedAt) return project;
    const updated = await repository.updateProject(tx, projectId, { archivedAt: new Date() });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project.archived",
      entityType: "project",
      entityId: projectId,
      metadata: { number: project.number },
    });
    return updated;
  });
}

export async function restoreProject(ctx: ServiceContext, projectId: string): Promise<Project> {
  assertCan(ctx.actor, "projects:archive");
  await requireReadableProject(ctx, projectId);
  return ctx.db.transaction(async (tx) => {
    const project = await lockExistingProject(tx, projectId);
    if (!project.archivedAt) return project;
    const updated = await repository.updateProject(tx, projectId, { archivedAt: null });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project.restored",
      entityType: "project",
      entityId: projectId,
      metadata: { number: project.number },
    });
    return updated;
  });
}

// --- Intervenants ------------------------------------------------------------------------------

export async function addProjectMember(
  ctx: ServiceContext,
  input: { projectId: string; memberId: string; role?: string | null },
): Promise<void> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(projectMemberSchema, input);
  const project = await requireReadableProject(ctx, parsed.projectId);
  assertProjectEditable(project);
  await assertAssignable(ctx.db, parsed.memberId, "memberId");
  await ctx.db.transaction(async (tx) => {
    const added = await production.insertProjectMember(tx, {
      projectId: parsed.projectId,
      memberId: parsed.memberId,
      role: parsed.role ?? null,
    });
    if (!added) return;
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_member.added",
      entityType: "project_member",
      entityId: parsed.projectId,
      metadata: { memberId: parsed.memberId, role: parsed.role ?? null },
    });
  });
}

export async function removeProjectMember(
  ctx: ServiceContext,
  input: { projectId: string; memberId: string },
): Promise<void> {
  assertCan(ctx.actor, "projects:update");
  const parsed = parseInput(removeProjectMemberSchema, input);
  const project = await requireReadableProject(ctx, parsed.projectId);
  assertProjectEditable(project);
  if (project.ownerMemberId === parsed.memberId) {
    throw new ConflictError("Désignez un autre responsable avant de retirer celui-ci.");
  }
  await ctx.db.transaction(async (tx) => {
    const removed = await production.deleteProjectMember(tx, parsed);
    if (!removed) return;
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "project_member.removed",
      entityType: "project_member",
      entityId: parsed.projectId,
      metadata: { memberId: parsed.memberId },
    });
  });
}

// --- Budget ------------------------------------------------------------------------------------

/** Même clé que `time.service` : un seul événement par projet, quel que soit l'émetteur. */
const budgetDedupeKey = (projectId: string) => `budget.threshold_80:${projectId}`;

/**
 * Émet `budget.threshold_80` si la consommation atteint 80 %, une seule fois par projet : la clé
 * d'unicité rend toute nouvelle émission sans effet, y compris après un retour sous le seuil.
 * À appeler dans la transaction qui saisit du temps.
 */
export async function checkProjectBudget(
  tx: Database,
  projectId: string,
  options: { actorId: string | null },
): Promise<{ percent: number | null; reached: boolean }> {
  const project = await repository.findProject(tx, projectId);
  if (!project) return { percent: null, reached: false };
  const totals = await repository.timeTotalsForProject(tx, projectId);
  const consumption = budgetConsumption({
    budgetCents: project.budgetCents,
    estimatedMinutes: project.estimatedMinutes,
    ...totals,
  });
  if (consumption.reached) {
    await emitEvent(tx, {
      type: "budget.threshold_80",
      entityType: "project",
      entityId: project.id,
      companyId: project.companyId,
      payload: { consumedCents: totals.consumedCents, budgetCents: project.budgetCents ?? 0 },
      actorId: options.actorId,
      dedupeKey: budgetDedupeKey(project.id),
    });
  }
  return { percent: consumption.percent, reached: consumption.reached };
}

/** Rattrapage périodique, pour les automatisations : couvre le temps saisi hors du service. */
export async function sweepProjectBudgets(db: Database): Promise<number> {
  const rows = await repository.listBudgetSweepRows(db);
  let reached = 0;
  for (const row of rows) {
    const consumption = budgetConsumption(row);
    if (!consumption.reached) continue;
    reached += 1;
    await emitEvent(db, {
      type: "budget.threshold_80",
      entityType: "project",
      entityId: row.projectId,
      companyId: row.companyId,
      payload: { consumedCents: row.consumedCents, budgetCents: row.budgetCents ?? 0 },
      actorId: null,
      dedupeKey: budgetDedupeKey(row.projectId),
    });
  }
  return reached;
}

// --- Lectures : liste --------------------------------------------------------------------------

export interface ProjectSummary {
  id: string;
  number: string;
  name: string;
  /** Offre, sans le nom du client. */
  offer: string;
  companyId: string;
  companyName: string;
  activityLabel: string | null;
  status: ProjectStatus;
  priority: Priority;
  dueOn: string | null;
  deliveredOn: string | null;
  estimatedMinutes: number | null;
  /** `2 · Design`. `null` tant qu'aucun jalon n'est engagé. */
  stage: { index: number; name: string } | null;
  progress: ProjectProgress;
  health: ProjectHealth;
  team: string[];
  archived: boolean;
}

function currentStage(phases: readonly ProjectPhase[]): { index: number; name: string } | null {
  const inProgress = phases.findIndex((phase) => phase.status === "in_progress");
  if (inProgress >= 0) {
    return { index: inProgress + 1, name: phases[inProgress]?.name ?? "" };
  }
  const doneCount = phases.filter((phase) => phase.status === "done").length;
  if (doneCount === 0) return null;
  const nextIndex = phases.findIndex((phase) => phase.status === "todo");
  const index = nextIndex >= 0 ? nextIndex : phases.length - 1;
  return { index: index + 1, name: phases[index]?.name ?? "" };
}

async function summarize(
  db: Database,
  rows: readonly repository.ProjectListRow[],
  today: string,
): Promise<ProjectSummary[]> {
  const ids = rows.map((row) => row.id);
  const [totals, phases, blockers, requirements, members] = await Promise.all([
    repository.taskTotalsByProject(db, ids),
    repository.phasesByProject(db, ids),
    repository.openBlockersByProject(db, ids),
    repository.expectedRequirementsByProject(db, ids),
    repository.membersByProject(db, ids),
  ]);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    name: row.name,
    offer: offerLabel(row.name, row.companyName),
    companyId: row.companyId,
    companyName: row.companyName,
    activityLabel: row.activity ? OFFER_ACTIVITY_LABELS[row.activity] : null,
    status: row.status,
    priority: row.priority,
    dueOn: row.dueOn,
    deliveredOn: row.deliveredOn,
    estimatedMinutes: row.estimatedMinutes,
    stage: currentStage(phases.get(row.id) ?? []),
    progress: projectProgress(totals.get(row.id) ?? EMPTY_TASK_TOTALS, row.estimatedMinutes),
    health: projectHealth(row, {
      today,
      openBlockers: blockers.get(row.id) ?? 0,
      expectedRequirements: requirements.get(row.id) ?? 0,
    }),
    team: (members.get(row.id) ?? []).map((member) => member.fullName),
    archived: row.archivedAt !== null,
  }));
}

export async function listProjects(
  ctx: ServiceContext,
  input: ProjectListInput = {},
  options: { now?: Date } = {},
): Promise<{ items: ProjectSummary[]; total: number; page: number; pageSize: number }> {
  const scope = await resolveProjectScope(ctx);
  const parsed = parseInput(projectListSchema, input);
  if (scope.assignedOnly && parsed.view === "archived") {
    return { items: [], total: 0, page: parsed.page, pageSize: parsed.pageSize };
  }
  const today = parisDay(options.now);
  const { items, total } = await repository.listProjects(ctx.db, {
    ...parsed,
    today,
    projectIds: scope.projectIds,
  });
  return {
    items: await summarize(ctx.db, items, today),
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

export interface ProjectsOverview {
  open: number;
  late: number;
  upcoming: number;
  /** Charge sur 6 semaines (module Temps) ; `null` pour qui ne voit que ce qui lui est affecté. */
  load: { weeks: WeekLoad[] } | null;
}

/** Résumé de l'en-tête de l'écran 08 et carte « Charge sur 6 semaines ». */
export async function getProjectsOverview(
  ctx: ServiceContext,
  options: { now?: Date } = {},
): Promise<ProjectsOverview> {
  const scope = await resolveProjectScope(ctx);
  const today = parisDay(options.now);
  const counts = await repository.countPortfolio(ctx.db, { today, projectIds: scope.projectIds });
  if (scope.assignedOnly) return { ...counts, load: null };
  return { ...counts, load: { weeks: await getSixWeekLoad(ctx.db, { today }) } };
}

// --- Lectures : fiche --------------------------------------------------------------------------

export interface DeliverableView {
  id: string;
  title: string;
  status: string;
  version: number;
  phaseId: string | null;
  documentId: string | null;
  documentTitle: string | null;
  requiresClientValidation: boolean;
  feedbackRoundsIncluded: number;
  /** Tours de retours déjà consommés. */
  feedbackRoundsUsed: number;
  reviews: {
    id: string;
    version: number;
    decision: string;
    comment: string | null;
    at: Date;
  }[];
  lastValidatedAt: Date | null;
}

export interface PlannedActual {
  soldMinutes: number | null;
  spentMinutes: number;
  plannedToDateMinutes: number | null;
  /** Temps passé moins prévu à date ; positif : en avance sur la consommation, donc dérive. */
  gapMinutes: number | null;
  /** Part consommée, en pourcentage, pour la jauge. */
  percent: number | null;
  /** Coût du temps et budget : avec `team:read_costs` seulement. */
  consumedCents: number | null;
  budgetCents: number | null;
}

export interface ProjectHistoryEntry {
  id: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  occurredAt: Date;
}

function describeProjectAudit(row: taskRepository.AuditRow): ProjectHistoryEntry {
  const { from, to } = row.metadata;
  const labels: Record<string, string> = PROJECT_STATUS_LABELS;
  return {
    id: row.id,
    title: AUDIT_ACTIONS[row.action as AuditAction] ?? row.action,
    detail:
      typeof from === "string" && typeof to === "string"
        ? `${labels[from] ?? from} → ${labels[to] ?? to}`
        : null,
    actorName: row.actorName,
    occurredAt: row.occurredAt,
  };
}

export interface ProjectDetail {
  id: string;
  number: string;
  name: string;
  title: string;
  offer: string;
  companyId: string;
  companyName: string;
  activity: Project["activity"];
  status: ProjectStatus;
  priority: Priority;
  objective: string | null;
  scope: string | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  startOn: string | null;
  dueOn: string | null;
  deliveredOn: string | null;
  estimatedMinutes: number | null;
  /** Masqué à qui ne voit que ce qui lui est affecté. */
  budgetCents: number | null;
  archived: boolean;
  quote: { id: string; number: string } | null;
  phases: ProjectPhase[];
  team: repository.ProjectMemberRow[];
  progress: ProjectProgress;
  health: ProjectHealth;
  blockers: Awaited<ReturnType<typeof production.listBlockers>>;
  deliverables: DeliverableView[];
  requirements: production.RequirementRow[];
  handover: Awaited<ReturnType<typeof production.listHandover>>;
  changeRequests: production.ChangeRequestRow[];
  planned: PlannedActual | null;
  /** Marge par `getMargin`, avec `finance:read` seulement. Indisponible : NULL, jamais un zéro. */
  margin: MarginBreakdown | null;
  /** Journal du projet. Vide pour qui ne voit que ce qui lui est affecté. */
  history: ProjectHistoryEntry[];
  sites: repository.ProjectSiteRow[];
  documents: repository.ProjectDocumentRow[];
  /** Transitions proposées à l'écran. Le service reste seul juge à l'exécution. */
  nextStatuses: ProjectStatus[];
  capabilities: {
    edit: boolean;
    addTask: boolean;
    archive: boolean;
    updateAnyTask: boolean;
    seeBudget: boolean;
    convertToQuote: boolean;
  };
}

async function readMargin(ctx: ServiceContext, projectId: string): Promise<MarginBreakdown | null> {
  if (!can(ctx.actor, "finance:read")) return null;
  try {
    return await getMargin(ctx.db, { scope: "project", id: projectId });
  } catch (error) {
    logger.warn("project.margin_unavailable", { projectId, error });
    return null;
  }
}

export async function getProjectDetail(
  ctx: ServiceContext,
  projectId: string,
  options: { now?: Date } = {},
): Promise<ProjectDetail> {
  const scope = await resolveProjectScope(ctx);
  await requireReadableProject(ctx, projectId);
  const header = await repository.findProjectHeader(ctx.db, projectId);
  if (!header) throw new NotFoundError("Projet introuvable.");
  const { project, companyName, ownerName, quoteNumber } = header;

  const today = parisDay(options.now);
  const seeBudget = !scope.assignedOnly;
  const [
    phases,
    membersMap,
    totals,
    blockers,
    deliverables,
    requirements,
    handover,
    sites,
    documents,
  ] = await Promise.all([
    production.listPhases(ctx.db, projectId),
    repository.membersByProject(ctx.db, [projectId]),
    repository.taskTotalsForProject(ctx.db, projectId),
    production.listBlockers(ctx.db, projectId),
    production.listDeliverables(ctx.db, projectId),
    production.listRequirements(ctx.db, projectId),
    production.listHandover(ctx.db, projectId),
    seeBudget ? repository.listSitesOfProject(ctx.db, projectId) : Promise.resolve([]),
    // Un prestataire lit les documents de ses projets, jamais les pièces commerciales. Sans
    // `finance:read`, le périmètre des documents masque aussi les factures des autres.
    seeBudget && can(ctx.actor, "finance:read")
      ? repository.listDocumentsOfProject(ctx.db, projectId)
      : listDocumentsFor(ctx, { projectId, limit: 200 }),
  ]);
  const readableDocuments = new Set(documents.map((document) => document.id));
  const [reviews, changeRequests, time, audit] = await Promise.all([
    production.reviewsByDeliverable(
      ctx.db,
      deliverables.map((deliverable) => deliverable.id),
    ),
    seeBudget ? production.listChangeRequests(ctx.db, projectId) : Promise.resolve([]),
    seeBudget ? repository.timeTotalsForProject(ctx.db, projectId) : Promise.resolve(null),
    seeBudget
      ? taskRepository.listEntityAudit(ctx.db, {
          entityType: "project",
          entityId: projectId,
          limit: 20,
        })
      : Promise.resolve([]),
  ]);

  const openBlockers = blockers.filter((blocker) => !blocker.resolvedAt).length;
  const expected = requirements.filter((item) => item.status === "expected").length;
  const seeCosts = can(ctx.actor, "team:read_costs");
  const editable =
    can(ctx.actor, "projects:update") && project.archivedAt === null && project.status !== "closed";

  const margin = await readMargin(ctx, projectId);

  let planned: PlannedActual | null = null;
  if (time) {
    const plannedToDateMinutes = plannedMinutesToDate({
      startOn: project.startOn,
      dueOn: project.dueOn,
      estimatedMinutes: project.estimatedMinutes,
      today,
    });
    planned = {
      soldMinutes: project.estimatedMinutes,
      spentMinutes: time.spentMinutes,
      plannedToDateMinutes,
      gapMinutes: plannedToDateMinutes === null ? null : time.spentMinutes - plannedToDateMinutes,
      percent: budgetConsumption({
        budgetCents: seeCosts ? project.budgetCents : null,
        estimatedMinutes: project.estimatedMinutes,
        consumedCents: time.consumedCents,
        spentMinutes: time.spentMinutes,
      }).percent,
      consumedCents: seeCosts ? time.consumedCents : null,
      budgetCents: seeCosts ? project.budgetCents : null,
    };
  }

  return {
    id: project.id,
    number: project.number,
    name: project.name,
    title: projectTitle(project.name, companyName),
    offer: offerLabel(project.name, companyName),
    companyId: project.companyId,
    companyName,
    activity: project.activity,
    status: project.status,
    priority: project.priority,
    objective: project.objective,
    scope: project.scope,
    ownerMemberId: project.ownerMemberId,
    ownerName,
    startOn: project.startOn,
    dueOn: project.dueOn,
    deliveredOn: project.deliveredOn,
    estimatedMinutes: project.estimatedMinutes,
    budgetCents: seeBudget ? project.budgetCents : null,
    archived: project.archivedAt !== null,
    quote:
      seeBudget && project.quoteId && quoteNumber
        ? { id: project.quoteId, number: quoteNumber }
        : null,
    phases,
    team: membersMap.get(projectId) ?? [],
    progress: projectProgress(totals, project.estimatedMinutes),
    health: projectHealth(project, { today, openBlockers, expectedRequirements: expected }),
    blockers,
    deliverables: deliverables.map((deliverable) => {
      const history = reviews.get(deliverable.id) ?? [];
      return {
        id: deliverable.id,
        title: deliverable.title,
        status: deliverable.status,
        version: deliverable.version,
        phaseId: deliverable.phaseId,
        ...(seeBudget || (deliverable.documentId && readableDocuments.has(deliverable.documentId))
          ? { documentId: deliverable.documentId, documentTitle: deliverable.documentTitle }
          : { documentId: null, documentTitle: null }),
        requiresClientValidation: deliverable.requiresClientValidation,
        feedbackRoundsIncluded: deliverable.feedbackRoundsIncluded,
        feedbackRoundsUsed: history.filter((review) => review.decision === "changes_requested")
          .length,
        reviews: history.map((review) => ({
          id: review.id,
          version: review.version,
          decision: review.decision,
          comment: review.comment,
          at: review.at,
        })),
        lastValidatedAt: history.find((review) => review.decision === "validated")?.at ?? null,
      };
    }),
    requirements,
    handover,
    changeRequests,
    planned,
    margin,
    history: audit.map(describeProjectAudit),
    sites,
    documents: documents.map(({ id, title, kind, visibility }) => ({
      id,
      title,
      kind,
      visibility,
    })),
    nextStatuses: PROJECT_TRANSITIONS[project.status].filter((status) =>
      canProjectTransition(project.status, status),
    ),
    capabilities: {
      edit: editable,
      addTask:
        can(ctx.actor, "tasks:create") &&
        project.archivedAt === null &&
        project.status !== "closed",
      archive: can(ctx.actor, "projects:archive"),
      updateAnyTask: can(ctx.actor, "tasks:update"),
      seeBudget,
      convertToQuote:
        editable && can(ctx.actor, "quotes:create") && can(ctx.actor, "quotes:update"),
    },
  };
}

// --- Fiche client et listes de choix -----------------------------------------------------------

export interface CompanyProjectRow {
  id: string;
  number: string;
  name: string;
  offer: string;
  status: ProjectStatus;
  dueOn: string | null;
  deliveredOn: string | null;
  stage: { index: number; name: string } | null;
  stepCount: number;
  progressPercent: number;
  budgetCents: number | null;
}

/** Projets d'un client pour la fiche 360° : lignes compactes, périmètre du rôle appliqué. */
export async function listProjectsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<CompanyProjectRow[]> {
  const scope = await resolveProjectScope(ctx);
  const parsed = parseInput(companyRowsSchema, { companyId, limit: options.limit });
  const rows = await repository.listProjectsOfCompany(ctx.db, {
    companyId: parsed.companyId,
    projectIds: scope.projectIds,
    limit: parsed.limit,
  });
  const ids = rows.map((row) => row.id);
  const [phases, totals] = await Promise.all([
    repository.phasesByProject(ctx.db, ids),
    repository.taskTotalsByProject(ctx.db, ids),
  ]);
  return rows.map((row) => {
    const projectPhases = phases.get(row.id) ?? [];
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      offer: offerLabel(row.name, row.companyName),
      status: row.status,
      dueOn: row.dueOn,
      deliveredOn: row.deliveredOn,
      stage: currentStage(projectPhases),
      stepCount: projectPhases.length,
      progressPercent: projectProgress(
        totals.get(row.id) ?? EMPTY_TASK_TOTALS,
        row.estimatedMinutes,
      ).percent,
      budgetCents: scope.assignedOnly ? null : row.budgetCents,
    };
  });
}

/** Personnes affectables, pour les formulaires du domaine. */
export async function listProjectAssignees(ctx: ServiceContext): Promise<MemberOption[]> {
  assertCanAny(ctx.actor, ["projects:create", "projects:update", "tasks:create", "tasks:update"]);
  return listAssignableMembers(ctx.db);
}

/** Retard d'un projet en jours, pour l'interface. */
export function lateDays(dueOn: string | null, now: Date = new Date()): number {
  if (!dueOn) return 0;
  return Math.max(0, daysBetween(dueOn, parisDay(now)));
}
