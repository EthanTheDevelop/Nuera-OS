import { getAssignedProjectIds, getMemberIdForUser } from "@/modules/team/team.lookup";
import { assertCanAny, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Project } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import * as repository from "./project.repository";
import { entityIdSchema } from "./project.schema";

/**
 * Périmètre de lecture, résolu une fois par opération et appliqué dans les requêtes :
 * `projectIds` vaut `null` pour qui lit tout, et la liste de ses projets pour un prestataire.
 */
export interface ProjectScope {
  projectIds: string[] | null;
  /** Fiche d'équipe du prestataire : ses tâches seules. `null` pour qui lit toutes les tâches. */
  assigneeMemberId: string | null;
  /** Le rôle se limite à ce qui lui est affecté. */
  assignedOnly: boolean;
}

export async function resolveProjectScope(ctx: ServiceContext): Promise<ProjectScope> {
  assertCanAny(ctx.actor, ["projects:read", "projects:read_assigned"]);
  if (can(ctx.actor, "projects:read")) {
    return { projectIds: null, assigneeMemberId: null, assignedOnly: false };
  }
  const [projectIds, memberId] = await Promise.all([
    getAssignedProjectIds(ctx.db, ctx.actor),
    getMemberIdForUser(ctx.db, ctx.actor.userId),
  ]);
  return { projectIds, assigneeMemberId: memberId, assignedOnly: true };
}

/** Projet lisible par l'acteur, sinon 404 : un objet hors périmètre n'existe pas pour lui. */
export async function requireReadableProject(
  ctx: ServiceContext,
  projectId: string,
): Promise<Project> {
  const scope = await resolveProjectScope(ctx);
  const id = parseInput(entityIdSchema, projectId);
  if (scope.projectIds !== null && !scope.projectIds.includes(id)) {
    throw new NotFoundError("Projet introuvable.");
  }
  const project = await repository.findProject(ctx.db, id);
  // Archiver retire le projet au prestataire : seule l'équipe le consulte et le restaure.
  if (!project || (scope.assignedOnly && project.archivedAt)) {
    throw new NotFoundError("Projet introuvable.");
  }
  return project;
}

/**
 * Verrou posé jusqu'à la fin de la transaction : les écritures d'un même projet passent l'une après
 * l'autre, et ce qui suit relit un état à jour. Une répétition simultanée voit donc l'effet de la
 * première au lieu de le rejouer.
 */
export async function lockExistingProject(tx: Database, projectId: string): Promise<Project> {
  const project = await repository.lockProject(tx, projectId);
  if (!project) throw new NotFoundError("Projet introuvable.");
  return project;
}

/** Même verrou, pour une écriture réservée à un projet encore modifiable. */
export async function lockEditableProject(tx: Database, projectId: string): Promise<Project> {
  const project = await lockExistingProject(tx, projectId);
  assertProjectEditable(project);
  return project;
}

/** Un projet archivé ou clôturé ne se modifie plus. */
export function assertProjectEditable(project: Pick<Project, "status" | "archivedAt">): void {
  if (project.archivedAt) {
    throw new ConflictError("Ce projet est archivé : restaurez-le pour le modifier.");
  }
  if (project.status === "closed") {
    throw new ConflictError("Ce projet est clôturé : il ne se modifie plus.");
  }
}
