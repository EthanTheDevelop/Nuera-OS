import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import {
  BILLING_PERIODS,
  COST_CATEGORIES,
  COST_NATURES,
  FINANCIAL_DOCUMENT_KINDS,
  FINANCIAL_DOCUMENT_SOURCES,
  FINANCIAL_DOCUMENT_STATUSES,
  SCHEDULE_ITEM_STATUSES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { contracts } from "./contracts";
import { companies } from "./crm";
import { documents } from "./documents";
import { projects } from "./projects";
import { quotes } from "./sales";
import { sites } from "./sites";
import { teamMembers } from "./team";

/** Références des factures tenues chez Indy : aucune facture créée ici n'a de valeur légale. */
export const financialDocuments = pgTable(
  "financial_documents",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    contractId: uuid("contract_id"),
    quoteId: uuid("quote_id"),
    /** Co-traitance (A12) : une échéance produit plusieurs documents, un par associé émetteur. */
    scheduleItemId: uuid("schedule_item_id"),
    kind: text("kind", { enum: FINANCIAL_DOCUMENT_KINDS }).notNull().default("invoice"),
    source: text("source", { enum: FINANCIAL_DOCUMENT_SOURCES }).notNull(),
    externalRef: text("external_ref"),
    issuerMemberId: uuid("issuer_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    issuedOn: date("issued_on"),
    dueOn: date("due_on"),
    amountCents: integer("amount_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    status: text("status", { enum: FINANCIAL_DOCUMENT_STATUSES }).notNull().default("issued"),
    paidOn: date("paid_on"),
    documentId: uuid("document_id"),
    clientVisible: boolean("client_visible").notNull().default(false),
    importedAt: instant("imported_at"),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("financial_documents_source_ref_unique").on(t.source, t.externalRef),
    unique("financial_documents_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "financial_documents_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "financial_documents_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    companyFk(
      "financial_documents_quote_company_fk",
      [t.quoteId, t.companyId],
      [quotes.id, quotes.companyId],
    ),
    companyFk(
      "financial_documents_schedule_company_fk",
      [t.scheduleItemId, t.companyId],
      [paymentScheduleItems.id, paymentScheduleItems.companyId],
    ),
    companyFk(
      "financial_documents_document_company_fk",
      [t.documentId, t.companyId],
      [documents.id, documents.companyId],
    ),
    enumCheck("financial_documents_kind_check", t.kind, FINANCIAL_DOCUMENT_KINDS),
    enumCheck("financial_documents_source_check", t.source, FINANCIAL_DOCUMENT_SOURCES),
    enumCheck("financial_documents_status_check", t.status, FINANCIAL_DOCUMENT_STATUSES),
    index("financial_documents_company_id_idx").on(t.companyId),
    index("financial_documents_project_id_idx").on(t.projectId),
    index("financial_documents_contract_id_idx").on(t.contractId),
    index("financial_documents_quote_id_idx").on(t.quoteId),
    index("financial_documents_schedule_item_id_idx").on(t.scheduleItemId),
    index("financial_documents_issuer_member_id_idx").on(t.issuerMemberId),
    index("financial_documents_document_id_idx").on(t.documentId),
    index("financial_documents_status_due_idx").on(t.status, t.dueOn),
    index("financial_documents_issued_on_idx").on(t.issuedOn),
    index("financial_documents_paid_on_idx").on(t.paidOn),
  ],
);

export const paymentScheduleItems = pgTable(
  "payment_schedule_items",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    quoteId: uuid("quote_id"),
    contractId: uuid("contract_id"),
    label: text("label").notNull(),
    dueOn: date("due_on"),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", { enum: SCHEDULE_ITEM_STATUSES }).notNull().default("planned"),
    /**
     * Document principal de l'échéance. En co-traitance, la liste complète se lit par
     * `financial_documents.schedule_item_id`.
     */
    financialDocumentId: uuid("financial_document_id"),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("payment_schedule_items_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "payment_schedule_items_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "payment_schedule_items_quote_company_fk",
      [t.quoteId, t.companyId],
      [quotes.id, quotes.companyId],
    ),
    companyFk(
      "payment_schedule_items_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    companyFk(
      "payment_schedule_items_document_company_fk",
      [t.financialDocumentId, t.companyId],
      [financialDocuments.id, financialDocuments.companyId],
    ),
    enumCheck("payment_schedule_items_status_check", t.status, SCHEDULE_ITEM_STATUSES),
    index("payment_schedule_items_company_id_idx").on(t.companyId),
    index("payment_schedule_items_project_id_idx").on(t.projectId),
    index("payment_schedule_items_quote_id_idx").on(t.quoteId),
    index("payment_schedule_items_contract_id_idx").on(t.contractId),
    index("payment_schedule_items_document_id_idx").on(t.financialDocumentId),
    index("payment_schedule_items_status_due_idx").on(t.status, t.dueOn),
  ],
);

export const directCosts = pgTable(
  "direct_costs",
  {
    id: id(),
    /** NULL : frais généraux de l'agence, sans client. */
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id"),
    siteId: uuid("site_id"),
    contractId: uuid("contract_id"),
    memberId: uuid("member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    label: text("label").notNull(),
    category: text("category", { enum: COST_CATEGORIES }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    incurredOn: date("incurred_on").notNull(),
    recurringPeriod: text("recurring_period", { enum: BILLING_PERIODS }),
    nature: text("nature", { enum: COST_NATURES }).notNull().default("actual"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "direct_costs_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk("direct_costs_site_company_fk", [t.siteId, t.companyId], [sites.id, sites.companyId]),
    companyFk(
      "direct_costs_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    check(
      "direct_costs_company_required_check",
      sql`(${t.projectId} is null and ${t.siteId} is null and ${t.contractId} is null) or ${t.companyId} is not null`,
    ),
    enumCheck("direct_costs_category_check", t.category, COST_CATEGORIES),
    enumCheck("direct_costs_recurring_period_check", t.recurringPeriod, BILLING_PERIODS),
    enumCheck("direct_costs_nature_check", t.nature, COST_NATURES),
    index("direct_costs_company_id_idx").on(t.companyId),
    index("direct_costs_project_id_idx").on(t.projectId),
    index("direct_costs_site_id_idx").on(t.siteId),
    index("direct_costs_contract_id_idx").on(t.contractId),
    index("direct_costs_member_id_idx").on(t.memberId),
    index("direct_costs_incurred_on_idx").on(t.incurredOn),
    index("direct_costs_nature_idx").on(t.nature),
  ],
);

export const financeImports = pgTable(
  "finance_imports",
  {
    id: id(),
    source: text("source", { enum: FINANCIAL_DOCUMENT_SOURCES }).notNull(),
    filename: text("filename"),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsCreated: integer("rows_created").notNull().default(0),
    rowsUpdated: integer("rows_updated").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    errors: jsonb("errors").$type<unknown[]>().notNull().default([]),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    enumCheck("finance_imports_source_check", t.source, FINANCIAL_DOCUMENT_SOURCES),
    index("finance_imports_at_idx").on(t.at),
    index("finance_imports_actor_id_idx").on(t.actorId),
  ],
);

export type FinancialDocument = typeof financialDocuments.$inferSelect;
export type PaymentScheduleItem = typeof paymentScheduleItems.$inferSelect;
export type DirectCost = typeof directCosts.$inferSelect;
export type FinanceImport = typeof financeImports.$inferSelect;
