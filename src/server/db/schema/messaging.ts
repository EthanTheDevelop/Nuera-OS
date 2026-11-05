import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  COMMENT_ENTITY_TYPES,
  MESSAGE_DIRECTIONS,
  SUGGESTION_STATUSES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps, uuidArray } from "./_columns";
import { users } from "./auth";
import { companies, contacts, opportunities } from "./crm";
import { documents } from "./documents";
import { projects } from "./projects";

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    contactId: uuid("contact_id"),
    subject: text("subject"),
    lastMessageAt: instant("last_message_at"),
    unreadInternal: integer("unread_internal").notNull().default(0),
    unreadClient: integer("unread_client").notNull().default(0),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("conversations_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "conversations_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "conversations_contact_company_fk",
      [t.contactId, t.companyId],
      [contacts.id, contacts.companyId],
    ),
    index("conversations_company_last_message_idx").on(t.companyId, t.lastMessageAt),
    index("conversations_project_id_idx").on(t.projectId),
    index("conversations_contact_id_idx").on(t.contactId),
    index("conversations_last_message_at_idx").on(t.lastMessageAt),
    index("conversations_archived_at_idx").on(t.archivedAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    /** Colonne de cloisonnement : conversation, auteur et pièce jointe sont du même client. */
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    conversationId: uuid("conversation_id").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "restrict" }),
    authorContactId: uuid("author_contact_id"),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    body: text("body").notNull(),
    mentions: uuidArray("mentions"),
    documentId: uuid("document_id"),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    unique("messages_id_conversation_unique").on(t.id, t.conversationId),
    companyFk(
      "messages_conversation_company_fk",
      [t.conversationId, t.companyId],
      [conversations.id, conversations.companyId],
    ),
    companyFk(
      "messages_author_contact_company_fk",
      [t.authorContactId, t.companyId],
      [contacts.id, contacts.companyId],
    ),
    companyFk(
      "messages_document_company_fk",
      [t.documentId, t.companyId],
      [documents.id, documents.companyId],
    ),
    enumCheck("messages_direction_check", t.direction, MESSAGE_DIRECTIONS),
    index("messages_conversation_at_idx").on(t.conversationId, t.at),
    index("messages_company_id_idx").on(t.companyId),
    index("messages_author_user_id_idx").on(t.authorUserId),
    index("messages_author_contact_id_idx").on(t.authorContactId),
    index("messages_document_id_idx").on(t.documentId),
    index("messages_mentions_idx").using("gin", t.mentions),
  ],
);

/** Suggestion seulement : l'envoi reste une action humaine (A10). */
export const replySuggestions = pgTable(
  "reply_suggestions",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references((): AnyPgColumn => conversations.id, { onDelete: "restrict" }),
    messageId: uuid("message_id"),
    body: text("body"),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("ready"),
    tone: text("tone"),
    contextSummary: text("context_summary"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "restrict" }),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "reply_suggestions_message_conversation_fk",
      [t.messageId, t.conversationId],
      [messages.id, messages.conversationId],
    ),
    enumCheck("reply_suggestions_status_check", t.status, SUGGESTION_STATUSES),
    index("reply_suggestions_conversation_status_idx").on(t.conversationId, t.status),
    index("reply_suggestions_message_id_idx").on(t.messageId),
    index("reply_suggestions_requested_by_idx").on(t.requestedBy),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    /** Colonne de cloisonnement : tâche, projet, ticket et livrable appartiennent à un client. */
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    entityType: text("entity_type", { enum: COMMENT_ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "restrict",
    }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    mentions: uuidArray("mentions"),
    documentId: uuid("document_id"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "comments_document_company_fk",
      [t.documentId, t.companyId],
      [documents.id, documents.companyId],
    ),
    enumCheck("comments_entity_type_check", t.entityType, COMMENT_ENTITY_TYPES),
    index("comments_entity_idx").on(t.entityType, t.entityId),
    index("comments_company_id_idx").on(t.companyId),
    index("comments_parent_id_idx").on(t.parentId),
    index("comments_author_user_id_idx").on(t.authorUserId),
    index("comments_document_id_idx").on(t.documentId),
    index("comments_mentions_idx").using("gin", t.mentions),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    /** NULL : rendez-vous pris avec un prospect sans fiche d'entreprise. */
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    contactId: uuid("contact_id"),
    projectId: uuid("project_id"),
    opportunityId: uuid("opportunity_id"),
    title: text("title").notNull(),
    kind: text("kind"),
    startsAt: instant("starts_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    channel: text("channel"),
    location: text("location"),
    memberIds: uuidArray("member_ids"),
    source: text("source", { enum: APPOINTMENT_SOURCES }).notNull().default("manual"),
    externalId: text("external_id").unique(),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull().default("planned"),
    /** Le client ne voit un rendez-vous sur son portail que si la case est cochée. */
    clientVisible: boolean("client_visible").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "appointments_contact_company_fk",
      [t.contactId, t.companyId],
      [contacts.id, contacts.companyId],
    ),
    companyFk(
      "appointments_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "appointments_opportunity_company_fk",
      [t.opportunityId, t.companyId],
      [opportunities.id, opportunities.companyId],
    ),
    enumCheck("appointments_source_check", t.source, APPOINTMENT_SOURCES),
    // Un projet a toujours un client ; un contact ou une affaire peuvent ne pas encore en avoir.
    check(
      "appointments_company_required_check",
      sql`${t.projectId} is null or ${t.companyId} is not null`,
    ),
    enumCheck("appointments_status_check", t.status, APPOINTMENT_STATUSES),
    index("appointments_company_id_idx").on(t.companyId),
    index("appointments_contact_id_idx").on(t.contactId),
    index("appointments_project_id_idx").on(t.projectId),
    index("appointments_opportunity_id_idx").on(t.opportunityId),
    index("appointments_starts_at_idx").on(t.startsAt),
    index("appointments_status_idx").on(t.status),
    index("appointments_member_ids_idx").using("gin", t.memberIds),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ReplySuggestion = typeof replySuggestions.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
