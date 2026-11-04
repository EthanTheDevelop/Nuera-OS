import {
  boolean,
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
  BILLING_PERIODS,
  CONTRACT_EVENT_KINDS,
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  SIGNATURE_STATUSES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { companies } from "./crm";
import { quotes } from "./sales";
import { sites } from "./sites";
import { tickets } from "./support";
import { teamMembers } from "./team";

export const maintenancePlans = pgTable(
  "maintenance_plans",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull().default(0),
    period: text("period", { enum: BILLING_PERIODS }).notNull().default("monthly"),
    includedMinutes: integer("included_minutes"),
    includedTickets: integer("included_tickets"),
    scope: text("scope"),
    exclusions: text("exclusions"),
    responseHours: integer("response_hours"),
    resolutionHours: integer("resolution_hours"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    enumCheck("maintenance_plans_period_check", t.period, BILLING_PERIODS),
    index("maintenance_plans_active_idx").on(t.active),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    number: text("number").notNull().unique(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    planId: uuid("plan_id").references((): AnyPgColumn => maintenancePlans.id, {
      onDelete: "restrict",
    }),
    quoteId: uuid("quote_id"),
    name: text("name").notNull(),
    kind: text("kind", { enum: CONTRACT_KINDS }).notNull(),
    status: text("status", { enum: CONTRACT_STATUSES }).notNull().default("to_start"),
    startOn: date("start_on"),
    endOn: date("end_on"),
    renewsOn: date("renews_on"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    priceCents: integer("price_cents").notNull().default(0),
    period: text("period", { enum: BILLING_PERIODS }).notNull().default("monthly"),
    monthlyCostCents: integer("monthly_cost_cents"),
    includedMinutes: integer("included_minutes"),
    includedTickets: integer("included_tickets"),
    scope: text("scope"),
    exclusions: text("exclusions"),
    conditions: text("conditions"),
    responseHours: integer("response_hours"),
    resolutionHours: integer("resolution_hours"),
    signatureStatus: text("signature_status", { enum: SIGNATURE_STATUSES })
      .notNull()
      .default("none"),
    docusealSubmissionId: text("docuseal_submission_id"),
    terminatedAt: instant("terminated_at"),
    terminationNote: text("termination_note"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("contracts_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "contracts_quote_company_fk",
      [t.quoteId, t.companyId],
      [quotes.id, quotes.companyId],
    ),
    enumCheck("contracts_kind_check", t.kind, CONTRACT_KINDS),
    enumCheck("contracts_status_check", t.status, CONTRACT_STATUSES),
    enumCheck("contracts_period_check", t.period, BILLING_PERIODS),
    enumCheck("contracts_signature_status_check", t.signatureStatus, SIGNATURE_STATUSES),
    index("contracts_company_id_idx").on(t.companyId),
    index("contracts_plan_id_idx").on(t.planId),
    index("contracts_quote_id_idx").on(t.quoteId),
    index("contracts_status_idx").on(t.status),
    index("contracts_kind_idx").on(t.kind),
    index("contracts_renews_on_idx").on(t.renewsOn),
    index("contracts_end_on_idx").on(t.endOn),
    index("contracts_docuseal_submission_id_idx").on(t.docusealSubmissionId),
    index("contracts_archived_at_idx").on(t.archivedAt),
  ],
);

export const contractSites = pgTable(
  "contract_sites",
  {
    id: id(),
    contractId: uuid("contract_id").notNull(),
    siteId: uuid("site_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    unique("contract_sites_contract_site_unique").on(t.contractId, t.siteId),
    companyFk(
      "contract_sites_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    companyFk(
      "contract_sites_site_company_fk",
      [t.siteId, t.companyId],
      [sites.id, sites.companyId],
    ),
    index("contract_sites_site_id_idx").on(t.siteId),
    index("contract_sites_company_id_idx").on(t.companyId),
  ],
);

export const contractEvents = pgTable(
  "contract_events",
  {
    id: id(),
    contractId: uuid("contract_id")
      .notNull()
      .references((): AnyPgColumn => contracts.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: CONTRACT_EVENT_KINDS }).notNull(),
    fromPriceCents: integer("from_price_cents"),
    toPriceCents: integer("to_price_cents"),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    enumCheck("contract_events_kind_check", t.kind, CONTRACT_EVENT_KINDS),
    index("contract_events_contract_at_idx").on(t.contractId, t.at),
    index("contract_events_actor_id_idx").on(t.actorId),
  ],
);

export const maintenanceInterventions = pgTable(
  "maintenance_interventions",
  {
    id: id(),
    /** Colonne de cloisonnement : le contrat, le site et le ticket sont du même client. */
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id").notNull(),
    siteId: uuid("site_id"),
    /** Parcours 3 : ticket → intervention → temps et quota. */
    ticketId: uuid("ticket_id"),
    title: text("title").notNull(),
    plannedOn: date("planned_on"),
    doneOn: date("done_on"),
    result: text("result"),
    minutes: integer("minutes"),
    memberId: uuid("member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "maintenance_interventions_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    companyFk(
      "maintenance_interventions_site_company_fk",
      [t.siteId, t.companyId],
      [sites.id, sites.companyId],
    ),
    companyFk(
      "maintenance_interventions_ticket_company_fk",
      [t.ticketId, t.companyId],
      [tickets.id, tickets.companyId],
    ),
    index("maintenance_interventions_company_id_idx").on(t.companyId),
    index("maintenance_interventions_contract_id_idx").on(t.contractId),
    index("maintenance_interventions_site_id_idx").on(t.siteId),
    index("maintenance_interventions_ticket_id_idx").on(t.ticketId),
    index("maintenance_interventions_member_id_idx").on(t.memberId),
    index("maintenance_interventions_planned_on_idx").on(t.plannedOn),
    index("maintenance_interventions_done_on_idx").on(t.doneOn),
  ],
);

export type MaintenancePlan = typeof maintenancePlans.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type ContractSite = typeof contractSites.$inferSelect;
export type ContractEvent = typeof contractEvents.$inferSelect;
export type MaintenanceIntervention = typeof maintenanceInterventions.$inferSelect;
