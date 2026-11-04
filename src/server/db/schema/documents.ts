import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITIES,
  KNOWLEDGE_KINDS,
  OFFER_ACTIVITIES,
  TEMPLATE_KINDS,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { contracts } from "./contracts";
import { companies } from "./crm";
import { projects } from "./projects";
import { quotes } from "./sales";
import { sites } from "./sites";
import { tickets } from "./support";

export const documents = pgTable(
  "documents",
  {
    id: id(),
    /** NULL : document interne de l'agence, sans client. */
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id"),
    contractId: uuid("contract_id"),
    siteId: uuid("site_id"),
    ticketId: uuid("ticket_id"),
    quoteId: uuid("quote_id"),
    title: text("title").notNull(),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull().default("other"),
    visibility: text("visibility", { enum: DOCUMENT_VISIBILITIES }).notNull().default("internal"),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("final"),
    currentVersionId: uuid("current_version_id"),
    uploadedByClient: boolean("uploaded_by_client").notNull().default(false),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("documents_id_company_unique").on(t.id, t.companyId),
    unique("documents_id_project_unique").on(t.id, t.projectId),
    companyFk(
      "documents_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "documents_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    companyFk("documents_site_company_fk", [t.siteId, t.companyId], [sites.id, sites.companyId]),
    companyFk(
      "documents_ticket_company_fk",
      [t.ticketId, t.companyId],
      [tickets.id, tickets.companyId],
    ),
    companyFk(
      "documents_quote_company_fk",
      [t.quoteId, t.companyId],
      [quotes.id, quotes.companyId],
    ),
    companyFk(
      "documents_current_version_fk",
      [t.currentVersionId, t.id],
      [documentVersions.id, documentVersions.documentId],
    ),
    check(
      "documents_company_required_check",
      sql`(${t.projectId} is null and ${t.contractId} is null and ${t.siteId} is null and ${t.ticketId} is null and ${t.quoteId} is null) or ${t.companyId} is not null`,
    ),
    // Un document partagé est toujours rattaché à un client : jamais visible par tous.
    check(
      "documents_client_visibility_check",
      sql`${t.visibility} <> 'client' or ${t.companyId} is not null`,
    ),
    enumCheck("documents_kind_check", t.kind, DOCUMENT_KINDS),
    enumCheck("documents_visibility_check", t.visibility, DOCUMENT_VISIBILITIES),
    enumCheck("documents_status_check", t.status, DOCUMENT_STATUSES),
    index("documents_company_visibility_idx").on(t.companyId, t.visibility),
    index("documents_current_version_id_idx").on(t.currentVersionId),
    index("documents_project_id_idx").on(t.projectId),
    index("documents_contract_id_idx").on(t.contractId),
    index("documents_site_id_idx").on(t.siteId),
    index("documents_ticket_id_idx").on(t.ticketId),
    index("documents_quote_id_idx").on(t.quoteId),
    index("documents_kind_idx").on(t.kind),
    index("documents_archived_at_idx").on(t.archivedAt),
    index("documents_title_search_idx").using("gin", sql`to_tsvector('simple', ${t.title})`),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references((): AnyPgColumn => documents.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("document_versions_document_version_unique").on(t.documentId, t.version),
    unique("document_versions_id_document_unique").on(t.id, t.documentId),
    index("document_versions_uploaded_by_user_id_idx").on(t.uploadedByUserId),
    index("document_versions_sha256_idx").on(t.sha256),
  ],
);

export const knowledgeArticles = pgTable(
  "knowledge_articles",
  {
    id: id(),
    kind: text("kind", { enum: KNOWLEDGE_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    siteId: uuid("site_id").references((): AnyPgColumn => sites.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references((): AnyPgColumn => projects.id, {
      onDelete: "restrict",
    }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    enumCheck("knowledge_articles_kind_check", t.kind, KNOWLEDGE_KINDS),
    index("knowledge_articles_kind_idx").on(t.kind),
    index("knowledge_articles_site_id_idx").on(t.siteId),
    index("knowledge_articles_project_id_idx").on(t.projectId),
    index("knowledge_articles_author_user_id_idx").on(t.authorUserId),
    index("knowledge_articles_archived_at_idx").on(t.archivedAt),
    index("knowledge_articles_title_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.title})`,
    ),
  ],
);

export const knowledgeArticleVersions = pgTable(
  "knowledge_article_versions",
  {
    id: id(),
    articleId: uuid("article_id")
      .notNull()
      .references((): AnyPgColumn => knowledgeArticles.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "restrict" }),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    unique("knowledge_article_versions_article_version_unique").on(t.articleId, t.version),
    index("knowledge_article_versions_author_user_id_idx").on(t.authorUserId),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: id(),
    kind: text("kind", { enum: TEMPLATE_KINDS }).notNull(),
    activity: text("activity", { enum: OFFER_ACTIVITIES }),
    name: text("name").notNull(),
    body: text("body"),
    items: jsonb("items").$type<unknown[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    enumCheck("templates_kind_check", t.kind, TEMPLATE_KINDS),
    enumCheck("templates_activity_check", t.activity, OFFER_ACTIVITIES),
    index("templates_kind_activity_idx").on(t.kind, t.activity),
    index("templates_active_idx").on(t.active),
  ],
);

export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type KnowledgeArticle = typeof knowledgeArticles.$inferSelect;
export type KnowledgeArticleVersion = typeof knowledgeArticleVersions.$inferSelect;
export type Template = typeof templates.$inferSelect;
