import { and, asc, eq, isNull } from "drizzle-orm";
import type { CommentEntityType } from "@/lib/domain-enums";
import {
  comments,
  deliverables,
  missions,
  projects,
  tasks,
  tickets,
  users,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export interface CommentTarget {
  companyId: string;
  projectId: string | null;
  assigneeMemberId: string | null;
}

/**
 * Client et projet de l'objet commenté, relus en base : le `companyId` transmis par l'appelant
 * n'est jamais cru sur parole.
 */
export async function findCommentTarget(
  db: Database,
  entityType: CommentEntityType,
  entityId: string,
): Promise<CommentTarget | null> {
  switch (entityType) {
    case "task": {
      const [row] = await db
        .select({
          companyId: projects.companyId,
          projectId: tasks.projectId,
          assigneeMemberId: tasks.assigneeMemberId,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(eq(tasks.id, entityId))
        .limit(1);
      return row ?? null;
    }
    case "project": {
      const [row] = await db
        .select({ companyId: projects.companyId, projectId: projects.id })
        .from(projects)
        .where(eq(projects.id, entityId))
        .limit(1);
      return row ? { ...row, assigneeMemberId: null } : null;
    }
    case "deliverable": {
      const [row] = await db
        .select({ companyId: projects.companyId, projectId: deliverables.projectId })
        .from(deliverables)
        .innerJoin(projects, eq(deliverables.projectId, projects.id))
        .where(and(eq(deliverables.id, entityId), isNull(deliverables.archivedAt)))
        .limit(1);
      return row ? { ...row, assigneeMemberId: null } : null;
    }
    case "ticket": {
      const [row] = await db
        .select({
          companyId: tickets.companyId,
          projectId: tickets.projectId,
          assigneeMemberId: tickets.assigneeMemberId,
        })
        .from(tickets)
        .where(eq(tickets.id, entityId))
        .limit(1);
      return row ?? null;
    }
  }
}

export async function hasMissionOnTicket(
  db: Database,
  memberId: string,
  ticketId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: missions.id })
    .from(missions)
    .where(and(eq(missions.memberId, memberId), eq(missions.ticketId, ticketId)))
    .limit(1);
  return Boolean(row);
}

export async function findComment(db: Database, id: string) {
  const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  return row ?? null;
}

export async function insertComment(db: Database, values: typeof comments.$inferInsert) {
  // `id` éventuellement fourni par le navigateur : un double envoi ne crée qu'un commentaire.
  const [row] = await db
    .insert(comments)
    .values(values)
    .onConflictDoNothing({ target: comments.id })
    .returning();
  return row ?? null;
}

export async function archiveComment(db: Database, id: string, at: Date) {
  await db
    .update(comments)
    .set({ archivedAt: at })
    .where(and(eq(comments.id, id), isNull(comments.archivedAt)));
}

/** Plafond de lecture d'un fil : un objet n'a pas des milliers de commentaires. */
const THREAD_LIMIT = 500;

export async function listComments(db: Database, entityType: CommentEntityType, entityId: string) {
  return db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      authorUserId: comments.authorUserId,
      authorName: users.name,
      body: comments.body,
      mentions: comments.mentions,
      documentId: comments.documentId,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorUserId, users.id))
    .where(
      and(
        eq(comments.entityType, entityType),
        eq(comments.entityId, entityId),
        isNull(comments.archivedAt),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(THREAD_LIMIT);
}
