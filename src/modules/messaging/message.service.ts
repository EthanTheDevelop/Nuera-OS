import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertDocumentReadable } from "@/modules/documents/document.service";
import { emitEvent } from "@/modules/platform/events";
import { assertCan, can, hasPermission } from "@/server/auth/permissions";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parsePagination, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { listMentionCandidates, type MentionOption } from "./comment.service";
import { assertMentionsValid, excerpt, filterMessageReaders, notifyMentioned } from "./mentions";
import * as repository from "./message.repository";
import type { ConversationRow, MessageRow } from "./message.repository";
import {
  createConversationSchema,
  portalMessageSchema,
  sendMessageSchema,
  type CreateConversationInput,
  type InboxFilter,
  type PortalMessageInput,
  type SendMessageInput,
} from "./messaging.schema";

/** Taille d'une page de fil : les messages plus anciens se chargent à la demande. */
export const THREAD_PAGE_SIZE = 50;
const CONVERSATION_PAGE_SIZE = 30;
const MAX_LIMIT = 100;

const uuid = z.uuid();

/** Un identifiant mal formé désigne un objet qui n'existe pas : même réponse qu'un 404. */
function toUuid(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new NotFoundError();
  return parsed.data;
}

function fullName(first: string | null, last: string | null): string | null {
  const name = [first, last].filter(Boolean).join(" ");
  return name || null;
}

// --- Vues --------------------------------------------------------------------------------------

export interface ConversationView {
  id: string;
  companyId: string;
  companyName: string;
  companyStatus: string;
  companyActivity: string | null;
  contactId: string | null;
  contactName: string | null;
  contactFirstName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectActivity: string | null;
  projectStepLabel: string | null;
  subject: string | null;
  lastMessageAt: Date | null;
  unread: number;
  lastExcerpt: string | null;
  lastDirection: "inbound" | "outbound" | "internal" | null;
  hasReadySuggestion: boolean;
  archived: boolean;
}

function toConversationView(row: ConversationRow): ConversationView {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.companyName,
    companyStatus: row.companyStatus,
    companyActivity: row.companyActivity,
    contactId: row.contactId,
    contactName: fullName(row.contactFirstName, row.contactLastName),
    contactFirstName: row.contactFirstName,
    projectId: row.projectId,
    projectName: row.projectName,
    projectActivity: row.projectActivity,
    projectStepLabel: row.projectStepLabel,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt,
    unread: row.unreadInternal,
    lastExcerpt: row.lastBody ? excerpt(row.lastBody) : null,
    lastDirection: row.lastDirection,
    hasReadySuggestion: row.hasReadySuggestion,
    archived: row.archivedAt !== null,
  };
}

export interface MessageAttachment {
  documentId: string;
  title: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound" | "internal";
  body: string;
  at: Date;
  mentions: string[];
  authorName: string;
  /** Message écrit par la personne connectée. */
  own: boolean;
  attachment: MessageAttachment | null;
}

function toMessageView(row: MessageRow, actorId: string): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    body: row.body,
    at: row.at,
    mentions: row.mentions,
    // Le contact prime : un message du client reste celui du client, avec ou sans compte.
    authorName:
      fullName(row.authorFirstName, row.authorLastName) ?? row.authorUserName ?? "Compte supprimé",
    own: row.authorUserId === actorId,
    attachment:
      row.documentId && row.documentTitle
        ? {
            documentId: row.documentId,
            title: row.documentTitle,
            filename: row.documentFilename,
            mimeType: row.documentMimeType,
            sizeBytes: row.documentSizeBytes,
          }
        : null,
  };
}

// --- Lecture de la boîte -----------------------------------------------------------------------

export async function listConversations(
  ctx: ServiceContext,
  query: { filter?: InboxFilter; search?: string; page?: unknown; pageSize?: unknown } = {},
): Promise<Paginated<ConversationView>> {
  assertCan(ctx.actor, "messages:read");
  const params: PageParams = parsePagination(query, {
    defaultPageSize: CONVERSATION_PAGE_SIZE,
    maxPageSize: MAX_LIMIT,
  });
  const result = await repository.listConversations(
    ctx.db,
    { filter: query.filter, search: query.search },
    params,
  );
  return { ...result, items: result.items.map(toConversationView) };
}

export async function getInboxCounts(ctx: ServiceContext) {
  assertCan(ctx.actor, "messages:read");
  return repository.countInbox(ctx.db);
}

export async function getConversation(
  ctx: ServiceContext,
  conversationId: string,
): Promise<ConversationView> {
  assertCan(ctx.actor, "messages:read");
  const row = await repository.findConversation(ctx.db, toUuid(conversationId));
  if (!row) throw new NotFoundError();
  return toConversationView(row);
}

/** Fil d'une conversation, du plus ancien au plus récent. `before` : messages plus anciens. */
export async function listMessages(
  ctx: ServiceContext,
  conversationId: string,
  options: { before?: { at: Date; id: string }; limit?: number } = {},
): Promise<{ items: MessageView[]; hasMore: boolean }> {
  assertCan(ctx.actor, "messages:read");
  const id = toUuid(conversationId);
  const conversation = await repository.findConversation(ctx.db, id);
  if (!conversation) throw new NotFoundError();
  const result = await repository.listMessages(ctx.db, id, {
    before: options.before?.at,
    beforeId: options.before?.id,
    limit: Math.min(options.limit ?? THREAD_PAGE_SIZE, MAX_LIMIT),
  });
  return {
    items: result.items.map((row) => toMessageView(row, ctx.actor.userId)),
    hasMore: result.hasMore,
  };
}

/** Résumé pour la fiche client 360°. */
export async function listConversationsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<ConversationView[]> {
  assertCan(ctx.actor, "messages:read");
  const rows = await repository.listConversationsForCompany(
    ctx.db,
    toUuid(companyId),
    Math.min(options.limit ?? 5, MAX_LIMIT),
  );
  return rows.map(toConversationView);
}

export interface MessageToHandle {
  conversationId: string;
  companyName: string;
  companyActivity: string | null;
  contactName: string | null;
  at: Date | null;
  excerpt: string | null;
  hasReadySuggestion: boolean;
  href: string;
}

/**
 * Tuile « Messages à traiter » du tableau de bord : le dernier message vient du client.
 * Sans contrôle d'accès : l'appelant est un service qui a déjà vérifié ses droits.
 */
export async function getMessagesToHandle(
  db: Database,
  options: { limit?: number } = {},
): Promise<MessageToHandle[]> {
  const rows = await repository.listAwaitingReply(db, Math.min(options.limit ?? 3, MAX_LIMIT));
  return rows.map((row) => ({
    conversationId: row.id,
    companyName: row.companyName,
    companyActivity: row.companyActivity,
    contactName: fullName(row.contactFirstName, row.contactLastName),
    at: row.lastMessageAt,
    excerpt: row.lastBody ? excerpt(row.lastBody) : null,
    hasReadySuggestion: row.hasReadySuggestion,
    href: `/messages/${row.id}`,
  }));
}

/**
 * Compteur de la barre latérale. Les non-lus sont ceux de l'équipe (`conversations.unread_internal`),
 * pas de chaque personne ; un compte sans accès aux messages n'en voit aucun.
 */
export async function getUnreadCount(db: Database, userId: string): Promise<number> {
  const role = await repository.findUserRole(db, userId);
  if (!role || !hasPermission(role, "messages:read")) return 0;
  return repository.sumUnreadInternal(db);
}

// --- Écriture côté équipe ----------------------------------------------------------------------

/** Le contact et le projet doivent appartenir au client choisi. */
async function assertLinksBelongToCompany(
  db: Database,
  input: { companyId: string; contactId?: string; projectId?: string },
): Promise<void> {
  if (!(await repository.findActiveCompanyId(db, input.companyId))) {
    throw new NotFoundError("Ce client n'existe pas ou a été archivé.");
  }
  if (
    input.contactId &&
    !(await repository.isActiveContactOfCompany(db, input.contactId, input.companyId))
  ) {
    throw new ValidationError("Ce contact n'appartient pas à ce client.", {
      contactId: ["Contact d'un autre client."],
    });
  }
  if (
    input.projectId &&
    !(await repository.isProjectOfCompany(db, input.projectId, input.companyId))
  ) {
    throw new ValidationError("Ce projet n'appartient pas à ce client.", {
      projectId: ["Projet d'un autre client."],
    });
  }
}

/** Effets communs d'un message reçu : non-lu pour l'équipe, événement, suggestions caduques. */
async function recordInbound(
  tx: Database,
  message: { id: string; conversationId: string; companyId: string; at: Date },
  actorId: string | null,
): Promise<void> {
  await repository.touchConversation(tx, message.conversationId, message.at, "internal");
  await repository.dismissOpenSuggestions(tx, message.conversationId);
  await emitEvent(tx, {
    type: "message.received",
    entityType: "message",
    entityId: message.id,
    companyId: message.companyId,
    payload: { conversationId: message.conversationId, direction: "inbound" },
    actorId,
    dedupeKey: `message.received:${message.id}`,
  });
}

export async function createConversation(
  ctx: ServiceContext,
  rawInput: CreateConversationInput,
): Promise<{ id: string }> {
  assertCan(ctx.actor, "messages:send");
  const input = parseInput(createConversationSchema, rawInput);
  await assertLinksBelongToCompany(ctx.db, input);

  return ctx.db.transaction(async (tx) => {
    const created = await repository.insertConversation(tx, {
      ...(input.clientRequestId ? { id: input.clientRequestId } : {}),
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      projectId: input.projectId ?? null,
      subject: input.subject || null,
    });

    if (!created) {
      // Double envoi du formulaire : la conversation existe déjà.
      const existing = await repository.findConversation(tx, input.clientRequestId ?? "");
      if (!existing || existing.companyId !== input.companyId) throw new NotFoundError();
      return { id: existing.id };
    }

    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "conversation.created",
      entityType: "conversation",
      entityId: created.id,
      metadata: { companyId: input.companyId },
    });

    if (input.firstMessage) {
      const at = new Date();
      const inbound = input.firstDirection === "inbound";
      const message = await repository.insertMessage(tx, {
        companyId: input.companyId,
        conversationId: created.id,
        authorUserId: inbound ? null : ctx.actor.userId,
        authorContactId: inbound ? input.contactId : null,
        direction: input.firstDirection,
        body: input.firstMessage,
        at,
      });
      if (!message) throw new Error("Premier message non enregistré");
      if (inbound) {
        await recordInbound(
          tx,
          { id: message.id, conversationId: created.id, companyId: input.companyId, at },
          ctx.actor.userId,
        );
      } else {
        await repository.touchConversation(
          tx,
          created.id,
          at,
          input.firstDirection === "outbound" ? "client" : null,
        );
      }
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "message.sent",
        entityType: "message",
        entityId: message.id,
        metadata: { conversationId: created.id, direction: input.firstDirection },
      });
    }
    return { id: created.id };
  });
}

export async function sendMessage(
  ctx: ServiceContext,
  rawInput: SendMessageInput,
): Promise<MessageView> {
  assertCan(ctx.actor, "messages:send");
  const input = parseInput(sendMessageSchema, rawInput);

  const conversation = await repository.findConversation(ctx.db, input.conversationId);
  if (!conversation) throw new NotFoundError();
  if (conversation.archivedAt) {
    throw new ConflictError("Cette conversation est archivée : ouvrez-en une nouvelle.");
  }

  for (const user of await assertMentionsValid(ctx.db, input.mentions)) {
    if (!hasPermission(user.role, "messages:read")) {
      throw new ValidationError(`${user.name} n'a pas accès aux messages.`, {
        mentions: [`${user.name} n'a pas accès aux messages.`],
      });
    }
  }

  if (input.documentId) {
    const document = await assertDocumentReadable(ctx, input.documentId);
    if (document.companyId !== conversation.companyId) throw new NotFoundError();
    if (input.direction === "outbound" && document.visibility !== "client") {
      throw new ConflictError(
        "Ce document est interne : partagez-le au client avant de le joindre à un message.",
      );
    }
  }

  const messageId = await ctx.db.transaction(async (tx) => {
    const at = new Date();
    const inserted = await repository.insertMessage(tx, {
      ...(input.clientRequestId ? { id: input.clientRequestId } : {}),
      companyId: conversation.companyId,
      conversationId: conversation.id,
      authorUserId: ctx.actor.userId,
      direction: input.direction,
      body: input.body,
      mentions: input.mentions,
      documentId: input.documentId ?? null,
      at,
    });

    if (!inserted) {
      // Double envoi : le message existe déjà, rien ne se répète.
      const existing = await repository.findMessage(tx, input.clientRequestId ?? "");
      if (
        !existing ||
        existing.conversationId !== conversation.id ||
        existing.authorUserId !== ctx.actor.userId
      ) {
        throw new NotFoundError();
      }
      return existing.id;
    }

    if (input.direction === "outbound") {
      await repository.touchConversation(tx, conversation.id, at, "client");
      // Répondre clôt les suggestions encore ouvertes : elles portaient sur la question précédente.
      await repository.dismissOpenSuggestions(tx, conversation.id);
    } else {
      await repository.touchConversation(tx, conversation.id, at, null);
    }

    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "message.sent",
      entityType: "message",
      entityId: inserted.id,
      metadata: { conversationId: conversation.id, direction: input.direction },
    });
    await notifyMentioned(tx, {
      mentions: input.mentions,
      actorId: ctx.actor.userId,
      title: `${ctx.actor.name} vous a mentionné · ${conversation.companyName}`,
      body: excerpt(input.body),
      href: `/messages/${conversation.id}`,
      entityType: "message",
      entityId: inserted.id,
    });
    return inserted.id;
  });

  const row = await repository.findMessage(ctx.db, messageId);
  if (!row) throw new NotFoundError();
  return toMessageView(row, ctx.actor.userId);
}

/**
 * Marque la conversation comme lue pour l'équipe. Un compte en lecture seule ne fait pas baisser le
 * compteur de ceux qui doivent répondre. Répétable : sans non-lu, rien n'est écrit.
 */
export async function markConversationRead(
  ctx: ServiceContext,
  conversationId: string,
): Promise<boolean> {
  assertCan(ctx.actor, "messages:read");
  if (!can(ctx.actor, "messages:send")) return false;
  return repository.markInternalRead(ctx.db, toUuid(conversationId));
}

/** Archive une conversation : les messages restent, plus rien ne s'y écrit. Répétable. */
export async function archiveConversation(
  ctx: ServiceContext,
  conversationId: string,
): Promise<void> {
  assertCan(ctx.actor, "messages:send");
  const id = toUuid(conversationId);
  const conversation = await repository.findConversation(ctx.db, id);
  if (!conversation) throw new NotFoundError();
  if (conversation.archivedAt) return;

  await ctx.db.transaction(async (tx) => {
    await repository.archiveConversation(tx, id, new Date());
    await repository.dismissOpenSuggestions(tx, id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "conversation.archived",
      entityType: "conversation",
      entityId: id,
      metadata: { companyId: conversation.companyId },
    });
  });
}

/** Rétablit une conversation archivée : le fil redevient visible et ouvert aux deux côtés. Répétable. */
export async function restoreConversation(
  ctx: ServiceContext,
  conversationId: string,
): Promise<void> {
  assertCan(ctx.actor, "messages:send");
  const id = toUuid(conversationId);
  const conversation = await repository.findConversation(ctx.db, id);
  if (!conversation) throw new NotFoundError();
  if (!conversation.archivedAt) return;

  await ctx.db.transaction(async (tx) => {
    await repository.restoreConversation(tx, id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "conversation.restored",
      entityType: "conversation",
      entityId: id,
      metadata: { companyId: conversation.companyId },
    });
  });
}

/** Personnes mentionnables dans un message : celles qui peuvent ouvrir le lien de la notification. */
export async function listMessageMentionCandidates(ctx: ServiceContext): Promise<MentionOption[]> {
  assertCan(ctx.actor, "messages:read");
  const candidates = await listMentionCandidates(ctx);
  const readers = await filterMessageReaders(
    ctx.db,
    candidates.map((item) => item.id),
  );
  return candidates.filter((item) => readers.has(item.id));
}

// --- Portail client ----------------------------------------------------------------------------

export interface PortalMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  body: string;
  at: Date;
  authorName: string;
  /** Écrit par le contact connecté (« Vous »). */
  own: boolean;
  attachment: MessageAttachment | null;
}

export interface PortalConversation {
  /** Conversation qui recevra le prochain message ; `null` tant qu'aucun échange n'existe. */
  conversationId: string | null;
  messages: PortalMessage[];
  hasMore: boolean;
  unread: number;
}

function toPortalMessage(
  row: Awaited<ReturnType<typeof repository.listPortalMessages>>["items"][number],
  contactId: string,
): PortalMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction === "inbound" ? "inbound" : "outbound",
    body: row.body,
    at: row.at,
    authorName:
      fullName(row.authorFirstName, row.authorLastName) ?? row.authorUserName ?? "Nuera Studio",
    own: row.authorContactId === contactId,
    attachment:
      row.documentId && row.documentTitle
        ? {
            documentId: row.documentId,
            title: row.documentTitle,
            filename: row.documentFilename,
            mimeType: row.documentMimeType,
            sizeBytes: row.documentSizeBytes,
          }
        : null,
  };
}

/**
 * Le fil vu par le client, sur ses seules conversations : aucune note interne, aucune suggestion,
 * aucune mention, aucune pièce jointe non partagée. `PortalContext` fait foi pour le cloisonnement.
 */
export async function listPortalConversation(
  ctx: PortalContext,
  options: { before?: { at: Date; id: string }; limit?: number } = {},
): Promise<PortalConversation> {
  const scope = { companyId: ctx.companyId, contactId: ctx.contactId };
  const [conversationId, result, unread] = await Promise.all([
    repository.findPortalConversationId(ctx.db, scope),
    repository.listPortalMessages(ctx.db, scope, {
      before: options.before?.at,
      beforeId: options.before?.id,
      limit: Math.min(options.limit ?? THREAD_PAGE_SIZE, MAX_LIMIT),
    }),
    repository.sumPortalUnread(ctx.db, scope),
  ]);
  return {
    conversationId,
    messages: result.items.map((row) => toPortalMessage(row, ctx.contactId)),
    hasMore: result.hasMore,
    unread,
  };
}

/** Compteur de la capsule du portail. */
export async function getPortalUnreadCount(ctx: PortalContext): Promise<number> {
  return repository.sumPortalUnread(ctx.db, {
    companyId: ctx.companyId,
    contactId: ctx.contactId,
  });
}

/**
 * Message d'un client. S'ajoute à sa conversation la plus récente, ou en ouvre une au premier
 * échange. Émet `message.received` une seule fois, dans la transaction.
 */
export async function sendPortalMessage(
  ctx: PortalContext,
  rawInput: PortalMessageInput,
): Promise<PortalMessage> {
  const input = parseInput(portalMessageSchema, rawInput);

  if (input.documentId) {
    // Répond 404 si le document n'est pas partagé à ce client.
    await assertDocumentReadable(ctx, input.documentId);
  }

  const scope = { companyId: ctx.companyId, contactId: ctx.contactId };
  const messageId = await ctx.db.transaction(async (tx) => {
    let conversationId = await repository.findPortalConversationId(tx, scope);
    if (!conversationId) {
      const created = await repository.insertConversation(tx, {
        companyId: ctx.companyId,
        contactId: ctx.contactId,
      });
      if (!created) throw new Error("Conversation non créée");
      conversationId = created.id;
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "conversation.created",
        entityType: "conversation",
        entityId: conversationId,
        metadata: { companyId: ctx.companyId, via: "portal" },
      });
    }

    const at = new Date();
    const inserted = await repository.insertMessage(tx, {
      ...(input.clientRequestId ? { id: input.clientRequestId } : {}),
      companyId: ctx.companyId,
      conversationId,
      authorUserId: ctx.actor.userId,
      authorContactId: ctx.contactId,
      direction: "inbound",
      body: input.body,
      documentId: input.documentId ?? null,
      at,
    });

    if (!inserted) {
      const existing = await repository.findMessage(tx, input.clientRequestId ?? "");
      if (!existing || existing.authorUserId !== ctx.actor.userId) throw new NotFoundError();
      return existing.id;
    }

    await recordInbound(
      tx,
      { id: inserted.id, conversationId, companyId: ctx.companyId, at },
      ctx.actor.userId,
    );
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "portal.message_sent",
      entityType: "message",
      entityId: inserted.id,
      metadata: { conversationId },
    });
    return inserted.id;
  });

  const { items } = await repository.listPortalMessages(ctx.db, scope, {
    limit: MAX_LIMIT,
  });
  const message = items.find((row) => row.id === messageId);
  if (!message) throw new NotFoundError();
  return toPortalMessage(message, ctx.contactId);
}

/** Le client a lu : remet ses non-lus à zéro sur son seul périmètre. Répétable. */
export async function markPortalRead(ctx: PortalContext): Promise<void> {
  await repository.markPortalRead(ctx.db, {
    companyId: ctx.companyId,
    contactId: ctx.contactId,
  });
}
