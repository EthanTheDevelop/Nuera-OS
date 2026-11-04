import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import {
  TICKET_CATEGORIES,
  TICKET_CHANNELS,
  TICKET_COVERAGES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { contracts } from "./contracts";
import { companies } from "./crm";
import { changeRequests, projects } from "./projects";
import { sites } from "./sites";
import { teamMembers } from "./team";

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    number: text("number").notNull().unique(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    siteId: uuid("site_id"),
    contractId: uuid("contract_id"),
    projectId: uuid("project_id"),
    subject: text("subject").notNull(),
    description: text("description"),
    channel: text("channel", { enum: TICKET_CHANNELS }).notNull(),
    category: text("category", { enum: TICKET_CATEGORIES }).notNull(),
    severity: text("severity", { enum: TICKET_SEVERITIES }).notNull().default("medium"),
    status: text("status", { enum: TICKET_STATUSES }).notNull().default("received"),
    assigneeMemberId: uuid("assignee_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    dueAt: instant("due_at"),
    firstResponseAt: instant("first_response_at"),
    resolvedAt: instant("resolved_at"),
    closedAt: instant("closed_at"),
    coverage: text("coverage", { enum: TICKET_COVERAGES }).notNull().default("undetermined"),
    isIncident: boolean("is_incident").notNull().default(false),
    openedByUserId: uuid("opened_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    changeRequestId: uuid("change_request_id"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("tickets_id_company_unique").on(t.id, t.companyId),
    companyFk("tickets_site_company_fk", [t.siteId, t.companyId], [sites.id, sites.companyId]),
    companyFk(
      "tickets_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    companyFk(
      "tickets_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "tickets_change_request_company_fk",
      [t.changeRequestId, t.companyId],
      [changeRequests.id, changeRequests.companyId],
    ),
    // `openIncidentTicket` est idempotent : un seul incident ouvert par site, même en concurrence.
    uniqueIndex("tickets_open_incident_unique")
      .on(t.siteId)
      .where(
        sql`${t.isIncident} and ${t.siteId} is not null and ${t.status} not in ('resolved', 'closed') and ${t.archivedAt} is null`,
      ),
    enumCheck("tickets_channel_check", t.channel, TICKET_CHANNELS),
    enumCheck("tickets_category_check", t.category, TICKET_CATEGORIES),
    enumCheck("tickets_severity_check", t.severity, TICKET_SEVERITIES),
    enumCheck("tickets_status_check", t.status, TICKET_STATUSES),
    enumCheck("tickets_coverage_check", t.coverage, TICKET_COVERAGES),
    index("tickets_company_status_idx").on(t.companyId, t.status),
    index("tickets_site_id_idx").on(t.siteId),
    index("tickets_contract_id_idx").on(t.contractId),
    index("tickets_project_id_idx").on(t.projectId),
    index("tickets_assignee_status_idx").on(t.assigneeMemberId, t.status),
    index("tickets_status_idx").on(t.status),
    index("tickets_severity_idx").on(t.severity),
    index("tickets_due_at_idx").on(t.dueAt),
    index("tickets_change_request_id_idx").on(t.changeRequestId),
    index("tickets_opened_by_user_id_idx").on(t.openedByUserId),
    index("tickets_archived_at_idx").on(t.archivedAt),
    index("tickets_subject_search_idx").using("gin", sql`to_tsvector('simple', ${t.subject})`),
  ],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references((): AnyPgColumn => tickets.id, { onDelete: "restrict" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    /** Invisible côté portail : le service de lecture du portail filtre sur cette colonne. */
    internal: boolean("internal").notNull().default(false),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index("ticket_messages_ticket_at_idx").on(t.ticketId, t.at),
    index("ticket_messages_author_user_id_idx").on(t.authorUserId),
  ],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references((): AnyPgColumn => tickets.id, { onDelete: "restrict" }),
    fromStatus: text("from_status", { enum: TICKET_STATUSES }),
    toStatus: text("to_status", { enum: TICKET_STATUSES }).notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    note: text("note"),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    enumCheck("ticket_events_from_status_check", t.fromStatus, TICKET_STATUSES),
    enumCheck("ticket_events_to_status_check", t.toStatus, TICKET_STATUSES),
    index("ticket_events_ticket_at_idx").on(t.ticketId, t.at),
    index("ticket_events_actor_id_idx").on(t.actorId),
  ],
);

export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type TicketEvent = typeof ticketEvents.$inferSelect;
