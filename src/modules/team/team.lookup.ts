import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Actor } from "@/server/auth/permissions";
import { missions, projectMembers, tasks, teamMembers } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Lectures partagées sur l'équipe : listes de choix (affectation, mentions) et périmètre d'un
 * prestataire. Sans contrôle d'accès : l'appelant est un service qui a déjà vérifié ses droits.
 * Ne renvoie jamais de coût ni de tarif.
 */
export interface MemberOption {
  id: string;
  userId: string | null;
  fullName: string;
  kind: string;
  title: string | null;
}

export async function listAssignableMembers(db: Database): Promise<MemberOption[]> {
  return db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      fullName: teamMembers.fullName,
      kind: teamMembers.kind,
      title: teamMembers.title,
    })
    .from(teamMembers)
    .where(and(eq(teamMembers.status, "active"), isNull(teamMembers.archivedAt)))
    .orderBy(asc(teamMembers.fullName));
}

/** Fiche d'équipe de l'utilisateur connecté, ou `null` s'il n'en a pas. */
export async function getMemberIdForUser(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Projets auxquels un acteur est rattaché : membre du projet, mission non annulée (une mission livrée
 * reste consultable) ou tâche non archivée qui lui est assignée. Une fiche inactive ou archivée n'ouvre
 * plus rien. Base du périmètre `*:read_assigned` d'un prestataire.
 */
export async function getAssignedProjectIds(db: Database, actor: Actor): Promise<string[]> {
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, actor.userId),
        eq(teamMembers.status, "active"),
        isNull(teamMembers.archivedAt),
      ),
    )
    .limit(1);
  if (!member) return [];
  const memberId = member.id;

  const [asMember, asMission, asAssignee] = await Promise.all([
    db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.memberId, memberId)),
    db
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(and(eq(missions.memberId, memberId), ne(missions.status, "cancelled"))),
    db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.assigneeMemberId, memberId), isNull(tasks.archivedAt))),
  ]);

  const ids = new Set<string>();
  for (const row of [...asMember, ...asMission, ...asAssignee]) {
    if (row.projectId) ids.add(row.projectId);
  }
  return [...ids];
}

/** Vrai si l'acteur est rattaché à ce projet. */
export async function isAssignedToProject(
  db: Database,
  actor: Actor,
  projectId: string,
): Promise<boolean> {
  const ids = await getAssignedProjectIds(db, actor);
  return ids.includes(projectId);
}

export async function getMembersByIds(db: Database, ids: string[]): Promise<MemberOption[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      fullName: teamMembers.fullName,
      kind: teamMembers.kind,
      title: teamMembers.title,
    })
    .from(teamMembers)
    .where(inArray(teamMembers.id, ids));
}
