import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  CATALOG_ITEM_KINDS,
  OFFER_ACTIVITIES,
  QUOTE_STATUSES,
  SIGNATURE_STATUSES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { companies, opportunities } from "./crm";

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: id(),
    kind: text("kind", { enum: CATALOG_ITEM_KINDS }).notNull(),
    activity: text("activity", { enum: OFFER_ACTIVITIES }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull().default(0),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    estimatedMinutes: integer("estimated_minutes").notNull().default(0),
    scope: text("scope"),
    exclusions: text("exclusions"),
    conditions: text("conditions"),
    validityDays: integer("validity_days"),
    depositPercent: integer("deposit_percent"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    enumCheck("catalog_items_kind_check", t.kind, CATALOG_ITEM_KINDS),
    enumCheck("catalog_items_activity_check", t.activity, OFFER_ACTIVITIES),
    check("catalog_items_deposit_check", sql`${t.depositPercent} between 0 and 100`),
    index("catalog_items_kind_idx").on(t.kind),
    index("catalog_items_activity_idx").on(t.activity),
    index("catalog_items_active_idx").on(t.active),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    number: text("number").notNull().unique(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id"),
    /** Avenant : devis d'origine, du même client. */
    parentQuoteId: uuid("parent_quote_id"),
    /** Offre affichée dans les listes (« client · offre », écran 09). */
    title: text("title").notNull(),
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
    currentVersionId: uuid("current_version_id"),
    acceptedVersionId: uuid("accepted_version_id"),
    issuedByNote: text("issued_by_note"),
    indyReference: text("indy_reference"),
    officialDocumentUrl: text("official_document_url"),
    docusealSubmissionId: text("docuseal_submission_id"),
    signatureStatus: text("signature_status", { enum: SIGNATURE_STATUSES })
      .notNull()
      .default("none"),
    signedAt: instant("signed_at"),
    sentAt: instant("sent_at"),
    acceptedAt: instant("accepted_at"),
    refusedAt: instant("refused_at"),
    lastReminderAt: instant("last_reminder_at"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("quotes_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "quotes_opportunity_company_fk",
      [t.opportunityId, t.companyId],
      [opportunities.id, opportunities.companyId],
    ),
    companyFk("quotes_parent_company_fk", [t.parentQuoteId, t.companyId], [t.id, t.companyId]),
    // Une version appartient à son devis : (version, devis) → quote_versions(id, quote_id).
    companyFk(
      "quotes_current_version_fk",
      [t.currentVersionId, t.id],
      [quoteVersions.id, quoteVersions.quoteId],
    ),
    companyFk(
      "quotes_accepted_version_fk",
      [t.acceptedVersionId, t.id],
      [quoteVersions.id, quoteVersions.quoteId],
    ),
    enumCheck("quotes_status_check", t.status, QUOTE_STATUSES),
    enumCheck("quotes_signature_status_check", t.signatureStatus, SIGNATURE_STATUSES),
    index("quotes_company_id_idx").on(t.companyId),
    index("quotes_opportunity_id_idx").on(t.opportunityId),
    index("quotes_parent_quote_id_idx").on(t.parentQuoteId),
    index("quotes_current_version_id_idx").on(t.currentVersionId),
    index("quotes_accepted_version_id_idx").on(t.acceptedVersionId),
    index("quotes_status_idx").on(t.status),
    index("quotes_signature_status_idx").on(t.signatureStatus),
    index("quotes_sent_at_idx").on(t.sentAt),
    index("quotes_docuseal_submission_id_idx").on(t.docusealSubmissionId),
    index("quotes_archived_at_idx").on(t.archivedAt),
  ],
);

export const quoteVersions = pgTable(
  "quote_versions",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references((): AnyPgColumn => quotes.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    scope: text("scope"),
    exclusions: text("exclusions"),
    conditions: text("conditions"),
    validUntil: date("valid_until"),
    depositPercent: integer("deposit_percent"),
    /** Total HT de la version, recalculé depuis ses lignes. */
    totalCents: integer("total_cents").notNull().default(0),
    /** Taux de TVA affiché (écran 09), figé avec la version. */
    taxPercent: integer("tax_percent").notNull().default(20),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    estimatedMinutes: integer("estimated_minutes").notNull().default(0),
    changeNote: text("change_note"),
    /** Date d'envoi de cette version : elle est figée dès cet instant. */
    sentAt: instant("sent_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    unique("quote_versions_quote_version_unique").on(t.quoteId, t.version),
    unique("quote_versions_id_quote_unique").on(t.id, t.quoteId),
    check("quote_versions_deposit_check", sql`${t.depositPercent} between 0 and 100`),
    index("quote_versions_created_by_idx").on(t.createdBy),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: id(),
    quoteVersionId: uuid("quote_version_id")
      .notNull()
      .references((): AnyPgColumn => quoteVersions.id, { onDelete: "restrict" }),
    catalogItemId: uuid("catalog_item_id").references((): AnyPgColumn => catalogItems.id, {
      onDelete: "restrict",
    }),
    label: text("label").notNull(),
    /** Unité affichée sur la ligne : « 15 j », « 12 mois » (écran 09). */
    unitLabel: text("unit_label"),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    estimatedMinutes: integer("estimated_minutes").notNull().default(0),
    position: integer("position").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check("quote_lines_quantity_check", sql`${t.quantity} > 0`),
    index("quote_lines_version_position_idx").on(t.quoteVersionId, t.position),
    index("quote_lines_catalog_item_id_idx").on(t.catalogItemId),
  ],
);

export type CatalogItem = typeof catalogItems.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type QuoteVersion = typeof quoteVersions.$inferSelect;
export type QuoteLine = typeof quoteLines.$inferSelect;
