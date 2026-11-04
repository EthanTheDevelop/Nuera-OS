import type { CommentEntityType as DomainCommentEntityType } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertDocumentReadable } from "@/modules/documents/document.service";
import {
  getAssignedProjectIds,
  getMemberIdForUser,
  listAssignableMembers,
} from "@/modules/team/team.lookup";
import {
  assertCanAny,
  hasPermission,
  type Actor,
  type Permission,
} from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Comment } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import * as commentRepository from "./comment.repository";
import type { CommentTarget } from "./comment.repository";
import { assertMentionsValid, excerpt, notifyMentioned } from "./mentions";
import { addCommentSchema, commentTargetSchema } from "./messaging.schema";

/**
 * Commentaires et mentions sur une tâche, un projet, un ticket ou un livrable (écran M4).
 * Contrat partagé, utilisé par les lots Projets et Support.
 *
 * L'appelant vérifie ses droits sur l'objet commenté, et ce service les revérifie : la permission
 * selon le type d'objet, le client réel de l'objet relu en base (jamais le `companyId` transmis),
 * et le périmètre du prestataire dans la requête.
 */
export type CommentEntityType = DomainCommentEntityType;

export interface CommentView {
  id: string;
  parentId: string | null;
  authorUserId: string;
  authorName: string;
  body: string;
  mentions: string[];
  documentId: string | null;
  createdAt: Date;
}

export interface AddCommentInput {
  entityType: CommentEntityType;
  entityId: string;
  companyId: string;
  body: string;
  mentions?: string[];
  parentId?: string;
  documentId?: string;
  /** Lien vers l'objet commenté, repris dans la notification des personnes mentionnées. */
  href: string;
  /** Identifiant généré par le navigateur : un double envoi ne crée qu'un commentaire. */
  clientRequestId?: string;
}

const READ_PERMISSIONS: Record<CommentEntityType, readonly Permission[]> = {
  task: ["tasks:read", "tasks:read_assigned"],
  project: ["projects:read", "projects:read_assigned"],
  deliverable: ["projects:read", "projects:read_assigned"],
  ticket: ["support:read", "support:read_assigned"],
};

/** Un prestataire commente ce qui lui est confié ; un compte en lecture seule ne commente pas. */
const WRITE_PERMISSIONS: Record<CommentEntityType, readonly Permission[]> = {
  task: ["tasks:update", "tasks:update_assigned"],
  project: ["projects:update", "tasks:update_assigned"],
  deliverable: ["projects:update", "tasks:update_assigned"],
  ticket: ["support:update", "support:read_assigned"],
};

/** Permission qui donne accès à tous les objets du type, sans filtre de périmètre. */
const FULL_ACCESS: Record<CommentEntityType, Permission> = {
  task: "tasks:read",
  project: "projects:read",
  deliverable: "projects:read",
  ticket: "support:read",
};

const ANY_READ = [...new Set(Object.values(READ_PERMISSIONS).flat())];
const ANY_WRITE = [...new Set(Object.values(WRITE_PERMISSIONS).flat())];

/**
 * Périmètre, le même que celui des services qui possèdent l'objet : une tâche se lit si elle est
 * assignée (`task.service`), une demande si elle est attribuée ou confiée par mission
 * (`ticket.service`). Être rattaché au projet n'ouvre que le projet et ses livrables.
 */
async function canReachTarget(
  db: Database,
  actor: Actor,
  type: CommentEntityType,
  entityId: string,
  target: CommentTarget,
): Promise<boolean> {
  if (hasPermission(actor.role, FULL_ACCESS[type])) return true;
  const memberId = await getMemberIdForUser(db, actor.userId);
  if (!memberId) return false;
  switch (type) {
    case "task":
      return target.assigneeMemberId === memberId;
    case "ticket":
      return (
        target.assigneeMemberId === memberId ||
        commentRepository.hasMissionOnTicket(db, memberId, entityId)
      );
    case "project":
    case "deliverable":
      return (
        target.projectId !== null &&
        (await getAssignedProjectIds(db, actor)).includes(target.projectId)
      );
  }
}

/** Objet absent, ou hors du périmètre : même réponse, l'existence ne se devine pas. */
async function loadTarget(ctx: ServiceContext, type: CommentEntityType, entityId: string) {
  const target = await commentRepository.findCommentTarget(ctx.db, type, entityId);
  if (!target || !(await canReachTarget(ctx.db, ctx.actor, type, entityId, target))) {
    throw new NotFoundError();
  }
  return target;
}

function toView(row: Comment, authorName: string): CommentView {
  return {
    id: row.id,
    parentId: row.parentId,
    authorUserId: row.authorUserId ?? "",
    authorName,
    body: row.body,
    mentions: row.mentions,
    documentId: row.documentId,
    createdAt: row.createdAt,
  };
}

export async function addComment(
  ctx: ServiceContext,
  rawInput: AddCommentInput,
): Promise<CommentView> {
  assertCanAny(ctx.actor, ANY_WRITE);
  const input = parseInput(addCommentSchema, rawInput);
  assertCanAny(ctx.actor, WRITE_PERMISSIONS[input.entityType]);

  const target = await loadTarget(ctx, input.entityType, input.entityId);
  // Un objet d'un autre client répond comme s'il n'existait pas.
  if (target.companyId !== input.companyId) throw new NotFoundError();

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await commentRepository.findComment(ctx.db, input.parentId);
    if (
      !parent ||
      parent.archivedAt ||
      parent.entityType !== input.entityType ||
      parent.entityId !== input.entityId
    ) {
      throw new ValidationError("Ce commentaire n'existe plus.", {
        parentId: ["Commentaire introuvable."],
      });
    }
    // Un seul niveau de réponse, comme M4 : répondre à une réponse revient au fil d'origine.
    parentId = parent.parentId ?? parent.id;
  }

  // Une mention envoie un extrait et un lien : elle ne vise que qui peut lire l'objet.
  for (const user of await assertMentionsValid(ctx.db, input.mentions)) {
    if (!(await canReachTarget(ctx.db, user, input.entityType, input.entityId, target))) {
      throw new ValidationError(`${user.name} n'a pas accès à cet élément.`, {
        mentions: [`${user.name} n'a pas accès à cet élément.`],
      });
    }
  }

  if (input.documentId) {
    const document = await assertDocumentReadable(ctx, input.documentId);
    if (document.companyId !== target.companyId) throw new NotFoundError();
  }

  return ctx.db.transaction(async (tx) => {
    const inserted = await commentRepository.insertComment(tx, {
      ...(input.clientRequestId ? { id: input.clientRequestId } : {}),
      companyId: target.companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      parentId,
      authorUserId: ctx.actor.userId,
      body: input.body,
      mentions: input.mentions,
      documentId: input.documentId ?? null,
    });

    if (!inserted) {
      // Double envoi : on renvoie le commentaire déjà créé, s'il vient bien de cette personne.
      const existing = await commentRepository.findComment(tx, input.clientRequestId ?? "");
      if (!existing || existing.authorUserId !== ctx.actor.userId) throw new NotFoundError();
      return toView(existing, ctx.actor.name);
    }

    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "comment.created",
      entityType: "comment",
      entityId: inserted.id,
      metadata: { entityType: input.entityType, entityId: input.entityId },
    });
    await notifyMentioned(tx, {
      mentions: input.mentions,
      actorId: ctx.actor.userId,
      title: `${ctx.actor.name} vous a mentionné`,
      body: excerpt(input.body),
      href: input.href,
      entityType: "comment",
      entityId: inserted.id,
    });
    return toView(inserted, ctx.actor.name);
  });
}

export async function listComments(
  ctx: ServiceContext,
  rawTarget: { entityType: CommentEntityType; entityId: string },
): Promise<CommentView[]> {
  assertCanAny(ctx.actor, ANY_READ);
  const { entityType, entityId } = parseInput(commentTargetSchema, rawTarget);
  assertCanAny(ctx.actor, READ_PERMISSIONS[entityType]);
  await loadTarget(ctx, entityType, entityId);

  const rows = await commentRepository.listComments(ctx.db, entityType, entityId);
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    authorUserId: row.authorUserId ?? "",
    authorName: row.authorName ?? "Compte supprimé",
    body: row.body,
    mentions: row.mentions,
    documentId: row.documentId,
    createdAt: row.createdAt,
  }));
}

/** Archive un commentaire : réservé à son auteur et aux associés. Répétable sans effet. */
export async function archiveComment(ctx: ServiceContext, commentId: string): Promise<void> {
  assertCanAny(ctx.actor, ANY_WRITE);
  const id = parseInput(z.uuid(), commentId);
  const comment = await commentRepository.findComment(ctx.db, id);
  if (!comment) throw new NotFoundError();
  await loadTarget(ctx, comment.entityType, comment.entityId);
  if (comment.authorUserId !== ctx.actor.userId && ctx.actor.role !== "admin") {
    throw new ForbiddenError("Seul l'auteur ou un associé peut retirer ce commentaire.");
  }
  if (comment.archivedAt) return;

  await ctx.db.transaction(async (tx) => {
    await commentRepository.archiveComment(tx, id, new Date());
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "comment.archived",
      entityType: "comment",
      entityId: id,
      metadata: { entityType: comment.entityType, entityId: comment.entityId },
    });
  });
}

export interface MentionOption {
  /** Identifiant du compte (`comments.mentions`, `messages.mentions`). */
  id: string;
  name: string;
  detail?: string;
}

/**
 * Personnes mentionnables : les membres actifs de l'équipe qui ont un compte.
 * Forme attendue par `CommentComposer` (`members`). Sans donnée de coût.
 */
export async function listMentionCandidates(ctx: ServiceContext): Promise<MentionOption[]> {
  assertCanAny(ctx.actor, [...ANY_READ, "messages:read"]);
  const members = await listAssignableMembers(ctx.db);
  return members.flatMap((member) =>
    member.userId
      ? [{ id: member.userId, name: member.fullName, detail: member.title ?? undefined }]
      : [],
  );
}
