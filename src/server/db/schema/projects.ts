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
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import {
  CHANGE_REQUEST_STATUSES,
  DELIVERABLE_STATUSES,
  OFFER_ACTIVITIES,
  PHASE_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  REQUIREMENT_STATUSES,
  REVIEW_DECISIONS,
  TASK_STATUSES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { companies, opportunities } from "./crm";
import { documents } from "./documents";
import { quotes } from "./sales";
import { tickets } from "./support";
import { teamMembers } from "./team";

export const projects = pgTable(
  "projects",
  {
    id: id(),
    number: text("number").notNull().unique(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id"),
    quoteId: uuid("quote_id"),
    name: text("name").notNull(),
    activity: text("activity", { enum: OFFER_ACTIVITIES }),
    objective: text("objective"),
    scope: text("scope"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("preparation"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
    ownerMemberId: uuid("owner_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    startOn: date("start_on"),
    dueOn: date("due_on"),
    deliveredOn: date("delivered_on"),
    budgetCents: integer("budget_cents"),
    estimatedMinutes: integer("estimated_minutes"),
    clientStepLabel: text("client_step_label"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("projects_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "projects_opportunity_company_fk",
      [t.opportunityId, t.companyId],
      [opportunities.id, opportunities.companyId],
    ),
    companyFk("projects_quote_company_fk", [t.quoteId, t.companyId], [quotes.id, quotes.companyId]),
    // Un devis accepté donne un seul projet.
    uniqueIndex("projects_quote_id_unique")
      .on(t.quoteId)
      .where(sql`${t.quoteId} is not null`),
    enumCheck("projects_activity_check", t.activity, OFFER_ACTIVITIES),
    enumCheck("projects_status_check", t.status, PROJECT_STATUSES),
    enumCheck("projects_priority_check", t.priority, PRIORITIES),
    index("projects_company_id_idx").on(t.companyId),
    index("projects_opportunity_id_idx").on(t.opportunityId),
    index("projects_owner_member_id_idx").on(t.ownerMemberId),
    index("projects_status_idx").on(t.status),
    index("projects_due_on_idx").on(t.dueOn),
    index("projects_archived_at_idx").on(t.archivedAt),
    index("projects_name_search_idx").using("gin", sql`to_tsvector('simple', ${t.name})`),
  ],
);

export const projectPhases = pgTable(
  "project_phases",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    dueOn: date("due_on"),
    status: text("status", { enum: PHASE_STATUSES }).notNull().default("todo"),
    clientVisible: boolean("client_visible").notNull().default(true),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("project_phases_id_project_unique").on(t.id, t.projectId),
    enumCheck("project_phases_status_check", t.status, PHASE_STATUSES),
    index("project_phases_project_position_idx").on(t.projectId, t.position),
    index("project_phases_due_on_idx").on(t.dueOn),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    number: text("number").notNull().unique(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    phaseId: uuid("phase_id"),
    parentTaskId: uuid("parent_task_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
    assigneeMemberId: uuid("assignee_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    dueOn: date("due_on"),
    estimatedMinutes: integer("estimated_minutes"),
    position: integer("position").notNull().default(0),
    completedAt: instant("completed_at"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    // Une tâche, sa phase et sa tâche parente appartiennent au même projet.
    unique("tasks_id_project_unique").on(t.id, t.projectId),
    companyFk(
      "tasks_phase_project_fk",
      [t.phaseId, t.projectId],
      [projectPhases.id, projectPhases.projectId],
    ),
    companyFk("tasks_parent_project_fk", [t.parentTaskId, t.projectId], [t.id, t.projectId]),
    enumCheck("tasks_status_check", t.status, TASK_STATUSES),
    enumCheck("tasks_priority_check", t.priority, PRIORITIES),
    index("tasks_project_status_idx").on(t.projectId, t.status),
    index("tasks_phase_id_idx").on(t.phaseId),
    index("tasks_parent_task_id_idx").on(t.parentTaskId),
    index("tasks_assignee_status_idx").on(t.assigneeMemberId, t.status),
    index("tasks_due_on_idx").on(t.dueOn),
    index("tasks_archived_at_idx").on(t.archivedAt),
  ],
);

/** Les cycles et les dépendances entre projets différents sont refusés par le service. */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: id(),
    taskId: uuid("task_id")
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: "restrict" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    unique("task_dependencies_pair_unique").on(t.taskId, t.dependsOnTaskId),
    check("task_dependencies_not_self_check", sql`${t.taskId} <> ${t.dependsOnTaskId}`),
    index("task_dependencies_depends_on_task_id_idx").on(t.dependsOnTaskId),
  ],
);

export const deliverables = pgTable(
  "deliverables",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    phaseId: uuid("phase_id"),
    title: text("title").notNull(),
    status: text("status", { enum: DELIVERABLE_STATUSES }).notNull().default("draft"),
    version: integer("version").notNull().default(1),
    documentId: uuid("document_id"),
    requiresClientValidation: boolean("requires_client_validation").notNull().default(false),
    feedbackRoundsIncluded: integer("feedback_rounds_included").notNull().default(0),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "deliverables_phase_project_fk",
      [t.phaseId, t.projectId],
      [projectPhases.id, projectPhases.projectId],
    ),
    // Le document d'un livrable est rattaché au même projet, donc au même client.
    companyFk(
      "deliverables_document_project_fk",
      [t.documentId, t.projectId],
      [documents.id, documents.projectId],
    ),
    enumCheck("deliverables_status_check", t.status, DELIVERABLE_STATUSES),
    index("deliverables_project_status_idx").on(t.projectId, t.status),
    index("deliverables_phase_id_idx").on(t.phaseId),
    index("deliverables_document_id_idx").on(t.documentId),
  ],
);

export const deliverableReviews = pgTable(
  "deliverable_reviews",
  {
    id: id(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references((): AnyPgColumn => deliverables.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    decision: text("decision", { enum: REVIEW_DECISIONS }).notNull(),
    comment: text("comment"),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "restrict" }),
    at: instant("at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    enumCheck("deliverable_reviews_decision_check", t.decision, REVIEW_DECISIONS),
    index("deliverable_reviews_deliverable_idx").on(t.deliverableId, t.at),
    index("deliverable_reviews_reviewer_user_id_idx").on(t.reviewerUserId),
  ],
);

export const projectBlockers = pgTable(
  "project_blockers",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    consequence: text("consequence"),
    decision: text("decision"),
    raisedAt: instant("raised_at").notNull().defaultNow(),
    resolvedAt: instant("resolved_at"),
    ...timestamps(),
  },
  (t) => [index("project_blockers_project_resolved_idx").on(t.projectId, t.resolvedAt)],
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    ticketId: uuid("ticket_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: CHANGE_REQUEST_STATUSES }).notNull().default("open"),
    estimatedMinutes: integer("estimated_minutes"),
    amountCents: integer("amount_cents"),
    quoteId: uuid("quote_id"),
    /** Le budget et le temps prévus du projet ont déjà été augmentés de cette demande. */
    budgetAppliedAt: instant("budget_applied_at"),
    ...timestamps(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("change_requests_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "change_requests_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "change_requests_ticket_company_fk",
      [t.ticketId, t.companyId],
      [tickets.id, tickets.companyId],
    ),
    companyFk(
      "change_requests_quote_company_fk",
      [t.quoteId, t.companyId],
      [quotes.id, quotes.companyId],
    ),
    enumCheck("change_requests_status_check", t.status, CHANGE_REQUEST_STATUSES),
    index("change_requests_company_id_idx").on(t.companyId),
    index("change_requests_project_id_idx").on(t.projectId),
    index("change_requests_ticket_id_idx").on(t.ticketId),
    index("change_requests_quote_id_idx").on(t.quoteId),
    index("change_requests_status_idx").on(t.status),
  ],
);

/** « Contenus attendus » du client. */
export const clientRequirements = pgTable(
  "client_requirements",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    status: text("status", { enum: REQUIREMENT_STATUSES }).notNull().default("expected"),
    dueOn: date("due_on"),
    receivedAt: instant("received_at"),
    documentId: uuid("document_id"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "client_requirements_document_project_fk",
      [t.documentId, t.projectId],
      [documents.id, documents.projectId],
    ),
    enumCheck("client_requirements_status_check", t.status, REQUIREMENT_STATUSES),
    index("client_requirements_project_status_idx").on(t.projectId, t.status),
    index("client_requirements_due_on_idx").on(t.dueOn),
    index("client_requirements_document_id_idx").on(t.documentId),
  ],
);

export const handoverChecklistItems = pgTable(
  "handover_checklist_items",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    doneAt: instant("done_at"),
    position: integer("position").notNull().default(0),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [index("handover_checklist_items_project_idx").on(t.projectId, t.position)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references((): AnyPgColumn => teamMembers.id, { onDelete: "restrict" }),
    role: text("role"),
    ...timestamps(),
  },
  (t) => [
    unique("project_members_project_member_unique").on(t.projectId, t.memberId),
    index("project_members_member_id_idx").on(t.memberId),
  ],
);

export type Project = typeof projects.$inferSelect;
export type ProjectPhase = typeof projectPhases.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type Deliverable = typeof deliverables.$inferSelect;
export type DeliverableReview = typeof deliverableReviews.$inferSelect;
export type ProjectBlocker = typeof projectBlockers.$inferSelect;
export type ChangeRequest = typeof changeRequests.$inferSelect;
export type ClientRequirement = typeof clientRequirements.$inferSelect;
export type HandoverChecklistItem = typeof handoverChecklistItems.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
