import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  MEMBER_KINDS,
  MEMBER_STATUSES,
  MISSION_STATUSES,
  TIME_CATEGORIES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, sqlList, textArray, timestamps } from "./_columns";
import { users } from "./auth";
import { companies } from "./crm";
import { projects, tasks } from "./projects";
import { contracts } from "./contracts";
import { tickets } from "./support";

export const teamMembers = pgTable(
  "team_members",
  {
    id: id(),
    /** NULL : prestataire sans compte. */
    userId: uuid("user_id")
      .unique()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: MEMBER_KINDS }).notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    skills: textArray("skills"),
    status: text("status", { enum: MEMBER_STATUSES }).notNull().default("active"),
    /** Capacité propre à chaque membre (A6) : rien n'est figé à deux associés. */
    weeklyCapacityMinutes: integer("weekly_capacity_minutes").notNull().default(0),
    // Coûts et tarifs : permission `team:read_costs`, `admin` uniquement.
    hourlyCostCents: integer("hourly_cost_cents"),
    dayRateCents: integer("day_rate_cents"),
    conditions: text("conditions"),
    specialty: text("specialty"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    enumCheck("team_members_kind_check", t.kind, MEMBER_KINDS),
    enumCheck("team_members_status_check", t.status, MEMBER_STATUSES),
    index("team_members_kind_idx").on(t.kind),
    index("team_members_status_idx").on(t.status),
    index("team_members_archived_at_idx").on(t.archivedAt),
    index("team_members_skills_idx").using("gin", t.skills),
  ],
);

export const memberAbsences = pgTable(
  "member_absences",
  {
    id: id(),
    memberId: uuid("member_id")
      .notNull()
      .references((): AnyPgColumn => teamMembers.id, { onDelete: "restrict" }),
    startOn: date("start_on").notNull(),
    endOn: date("end_on").notNull(),
    reason: text("reason"),
    ...timestamps(),
  },
  (t) => [
    check("member_absences_dates_check", sql`${t.endOn} >= ${t.startOn}`),
    index("member_absences_member_start_idx").on(t.memberId, t.startOn),
  ],
);

export const missions = pgTable(
  "missions",
  {
    id: id(),
    memberId: uuid("member_id")
      .notNull()
      .references((): AnyPgColumn => teamMembers.id, { onDelete: "restrict" }),
    /** Colonne de cloisonnement : projet et ticket liés sont du même client. */
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id"),
    taskId: uuid("task_id"),
    ticketId: uuid("ticket_id"),
    title: text("title").notNull(),
    deliverableLabel: text("deliverable_label"),
    deliverableReceivedOn: date("deliverable_received_on"),
    dueOn: date("due_on"),
    status: text("status", { enum: MISSION_STATUSES }).notNull().default("planned"),
    plannedCostCents: integer("planned_cost_cents"),
    committedCostCents: integer("committed_cost_cents"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "missions_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "missions_ticket_company_fk",
      [t.ticketId, t.companyId],
      [tickets.id, tickets.companyId],
    ),
    companyFk("missions_task_project_fk", [t.taskId, t.projectId], [tasks.id, tasks.projectId]),
    check(
      "missions_company_required_check",
      sql`(${t.projectId} is null and ${t.ticketId} is null) or ${t.companyId} is not null`,
    ),
    check("missions_task_project_check", sql`${t.taskId} is null or ${t.projectId} is not null`),
    enumCheck("missions_status_check", t.status, MISSION_STATUSES),
    index("missions_member_status_idx").on(t.memberId, t.status),
    index("missions_company_id_idx").on(t.companyId),
    index("missions_project_id_idx").on(t.projectId),
    index("missions_task_id_idx").on(t.taskId),
    index("missions_ticket_id_idx").on(t.ticketId),
    index("missions_due_on_idx").on(t.dueOn),
  ],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    memberId: uuid("member_id")
      .notNull()
      .references((): AnyPgColumn => teamMembers.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id"),
    taskId: uuid("task_id"),
    ticketId: uuid("ticket_id"),
    contractId: uuid("contract_id"),
    workOn: date("work_on").notNull(),
    minutes: integer("minutes").notNull(),
    category: text("category", { enum: TIME_CATEGORIES }).notNull(),
    billable: boolean("billable").notNull().default(true),
    /** Coût horaire figé à la saisie : source du coût du temps dans `getMargin`. */
    hourlyCostCents: integer("hourly_cost_cents").notNull().default(0),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "time_entries_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "time_entries_ticket_company_fk",
      [t.ticketId, t.companyId],
      [tickets.id, tickets.companyId],
    ),
    companyFk(
      "time_entries_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    companyFk("time_entries_task_project_fk", [t.taskId, t.projectId], [tasks.id, tasks.projectId]),
    check("time_entries_minutes_check", sql`${t.minutes} > 0`),
    // Au moins un rattachement, sauf prospection et administratif.
    check(
      "time_entries_attachment_check",
      sql`${t.category} in (${sqlList(["prospecting", "admin"])}) or ${t.companyId} is not null`,
    ),
    check(
      "time_entries_company_required_check",
      sql`(${t.projectId} is null and ${t.ticketId} is null and ${t.contractId} is null) or ${t.companyId} is not null`,
    ),
    check(
      "time_entries_task_project_check",
      sql`${t.taskId} is null or ${t.projectId} is not null`,
    ),
    enumCheck("time_entries_category_check", t.category, TIME_CATEGORIES),
    index("time_entries_member_work_on_idx").on(t.memberId, t.workOn),
    index("time_entries_company_work_on_idx").on(t.companyId, t.workOn),
    index("time_entries_project_work_on_idx").on(t.projectId, t.workOn),
    index("time_entries_task_id_idx").on(t.taskId),
    index("time_entries_ticket_id_idx").on(t.ticketId),
    index("time_entries_contract_work_on_idx").on(t.contractId, t.workOn),
    index("time_entries_work_on_idx").on(t.workOn),
    index("time_entries_category_idx").on(t.category),
    index("time_entries_created_by_idx").on(t.createdBy),
  ],
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type MemberAbsence = typeof memberAbsences.$inferSelect;
export type Mission = typeof missions.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
