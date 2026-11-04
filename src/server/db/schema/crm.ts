import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  ACTIVITY_KINDS,
  COMPANY_STATUSES,
  CONTACT_ROLES,
  OPPORTUNITY_STAGES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, sqlList, textArray, timestamps } from "./_columns";
import { users } from "./auth";
import { teamMembers } from "./team";

/**
 * Projection locale de Twenty, maître des organisations, contacts, opportunités et activités.
 *
 * Les colonnes (T) ne s'écrivent qu'à travers `CrmGateway`, puis se reflètent ici. Le reste
 * appartient à Nuera OS. `company_id` reste facultatif sur `contacts`, `opportunities` et
 * `activities` : Twenty accepte une personne ou une affaire sans organisation, et une affaire
 * gagnée doit seulement en avoir une au moment de la clôture (voir `opportunity.status.ts`).
 */
export const companies = pgTable(
  "companies",
  {
    id: id(),
    twentyId: text("twenty_id").notNull().unique(),
    // (T)
    name: text("name").notNull(),
    domain: text("domain"),
    addressLine: text("address_line"),
    city: text("city"),
    postalCode: text("postal_code"),
    country: text("country"),
    // Nuera OS
    status: text("status", { enum: COMPANY_STATUSES }).notNull().default("prospect"),
    /** Métier du client, en clair (« Fleuriste »). À ne pas confondre avec `OFFER_ACTIVITIES`. */
    activity: text("activity"),
    siren: text("siren"),
    phone: text("phone"),
    source: text("source"),
    tags: textArray("tags"),
    ownerMemberId: uuid("owner_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    notes: text("notes"),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    archivedAt: instant("archived_at"),
    twentySyncedAt: instant("twenty_synced_at"),
    ...timestamps(),
  },
  (t) => [
    enumCheck("companies_status_check", t.status, COMPANY_STATUSES),
    // Une fiche absorbée libère son SIREN pour la fiche gagnante.
    uniqueIndex("companies_siren_unique")
      .on(t.siren)
      .where(sql`${t.siren} is not null and ${t.mergedIntoId} is null`),
    index("companies_status_idx").on(t.status),
    index("companies_owner_member_id_idx").on(t.ownerMemberId),
    index("companies_merged_into_id_idx").on(t.mergedIntoId),
    index("companies_archived_at_idx").on(t.archivedAt),
    index("companies_source_idx").on(t.source),
    index("companies_domain_lower_idx").on(sql`lower(${t.domain})`),
    index("companies_tags_idx").using("gin", t.tags),
    // Recherche par mots : `to_tsvector('simple', name) @@ to_tsquery('simple', …)`, voir
    // `prefixTsQuery` dans `src/server/pagination.ts`.
    index("companies_name_search_idx").using("gin", sql`to_tsvector('simple', ${t.name})`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    twentyId: text("twenty_id").notNull().unique(),
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    // (T)
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    // Nuera OS
    roles: textArray("roles").$type<(typeof CONTACT_ROLES)[number][]>(),
    isPrimary: boolean("is_primary").notNull().default(false),
    notes: text("notes"),
    archivedAt: instant("archived_at"),
    twentySyncedAt: instant("twenty_synced_at"),
    ...timestamps(),
  },
  (t) => [
    unique("contacts_id_company_unique").on(t.id, t.companyId),
    check("contacts_roles_check", sql`${t.roles} <@ array[${sqlList(CONTACT_ROLES)}]::text[]`),
    index("contacts_company_id_idx").on(t.companyId),
    index("contacts_email_lower_idx").on(sql`lower(${t.email})`),
    index("contacts_archived_at_idx").on(t.archivedAt),
    index("contacts_roles_idx").using("gin", t.roles),
    index("contacts_name_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.firstName} || ' ' || ${t.lastName} || ' ' || coalesce(${t.email}, ''))`,
    ),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    twentyId: text("twenty_id").notNull().unique(),
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    contactId: uuid("contact_id"),
    // (T)
    name: text("name").notNull(),
    stage: text("stage", { enum: OPPORTUNITY_STAGES }).notNull().default("NEW"),
    amountCents: integer("amount_cents"),
    expectedCloseOn: date("expected_close_on"),
    // Nuera OS
    probability: integer("probability"),
    source: text("source"),
    need: text("need"),
    budgetEstimateCents: integer("budget_estimate_cents"),
    ownerMemberId: uuid("owner_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    nextAction: text("next_action"),
    nextActionOn: date("next_action_on"),
    lostReason: text("lost_reason"),
    wonAt: instant("won_at"),
    lostAt: instant("lost_at"),
    lastActivityAt: instant("last_activity_at"),
    archivedAt: instant("archived_at"),
    twentySyncedAt: instant("twenty_synced_at"),
    ...timestamps(),
  },
  (t) => [
    unique("opportunities_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "opportunities_contact_company_fk",
      [t.contactId, t.companyId],
      [contacts.id, contacts.companyId],
    ),
    enumCheck("opportunities_stage_check", t.stage, OPPORTUNITY_STAGES),
    check("opportunities_probability_check", sql`${t.probability} between 0 and 100`),
    index("opportunities_company_id_idx").on(t.companyId),
    index("opportunities_contact_id_idx").on(t.contactId),
    index("opportunities_owner_member_id_idx").on(t.ownerMemberId),
    index("opportunities_stage_idx").on(t.stage),
    index("opportunities_source_idx").on(t.source),
    index("opportunities_next_action_on_idx").on(t.nextActionOn),
    index("opportunities_expected_close_on_idx").on(t.expectedCloseOn),
    index("opportunities_last_activity_at_idx").on(t.lastActivityAt),
    index("opportunities_archived_at_idx").on(t.archivedAt),
  ],
);

export const opportunityStageHistory = pgTable(
  "opportunity_stage_history",
  {
    id: id(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references((): AnyPgColumn => opportunities.id, { onDelete: "restrict" }),
    /** NULL à la création de l'affaire. */
    fromStage: text("from_stage", { enum: OPPORTUNITY_STAGES }),
    toStage: text("to_stage", { enum: OPPORTUNITY_STAGES }).notNull(),
    /** NULL = changement venu de Twenty ou d'une tâche planifiée. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    enumCheck("opportunity_stage_history_from_check", t.fromStage, OPPORTUNITY_STAGES),
    enumCheck("opportunity_stage_history_to_check", t.toStage, OPPORTUNITY_STAGES),
    index("opportunity_stage_history_opportunity_idx").on(t.opportunityId, t.at),
    index("opportunity_stage_history_actor_id_idx").on(t.actorId),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: id(),
    /** Notes et tâches seulement : appels, réunions et e-mails restent locaux. */
    twentyId: text("twenty_id").unique(),
    kind: text("kind", { enum: ACTIVITY_KINDS }).notNull(),
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    contactId: uuid("contact_id"),
    opportunityId: uuid("opportunity_id"),
    subject: text("subject").notNull(),
    body: text("body"),
    dueAt: instant("due_at"),
    completedAt: instant("completed_at"),
    ownerMemberId: uuid("owner_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "activities_contact_company_fk",
      [t.contactId, t.companyId],
      [contacts.id, contacts.companyId],
    ),
    companyFk(
      "activities_opportunity_company_fk",
      [t.opportunityId, t.companyId],
      [opportunities.id, opportunities.companyId],
    ),
    enumCheck("activities_kind_check", t.kind, ACTIVITY_KINDS),
    index("activities_company_occurred_idx").on(t.companyId, t.occurredAt),
    index("activities_contact_id_idx").on(t.contactId),
    index("activities_opportunity_id_idx").on(t.opportunityId),
    index("activities_owner_member_id_idx").on(t.ownerMemberId),
    index("activities_kind_idx").on(t.kind),
    index("activities_due_at_idx").on(t.dueAt),
  ],
);

export const crmSyncState = pgTable("crm_sync_state", {
  id: id(),
  object: text("object").notNull().unique(),
  cursor: text("cursor"),
  lastRunAt: instant("last_run_at"),
  lastError: text("last_error"),
  ...timestamps(),
});

export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type OpportunityStageChange = typeof opportunityStageHistory.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type CrmSyncState = typeof crmSyncState.$inferSelect;
