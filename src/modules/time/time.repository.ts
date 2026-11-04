import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { TimeCategory } from "@/lib/domain-enums";
import {
  companies,
  contracts,
  maintenanceInterventions,
  memberAbsences,
  missions,
  projectMembers,
  projects,
  sites,
  tasks,
  teamMembers,
  tickets,
  timeEntries,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import type { PlanningData } from "./capacity";
import type { DayRange } from "./calendar";

const CLOSED_PROJECT_STATUSES = ["delivered", "closed"] as const;
const OPEN_MISSION_STATUSES = ["planned", "in_progress"] as const;
const CLOSED_TICKET_STATUSES = ["resolved", "closed"] as const;
const OPEN_CONTRACT_STATUSES = ["to_start", "active", "to_review"] as const;

const minutesSum = sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`;
/** Coût du temps : minutes × coût horaire figé à la saisie, arrondi au centime. */
const costSum = sql<number>`coalesce(round(sum(${timeEntries.minutes}::bigint * ${timeEntries.hourlyCostCents}) / 60.0), 0)::bigint`;
const billableSum = sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end), 0)::int`;
const nonBillableSum = sql<number>`coalesce(sum(case when ${timeEntries.billable} then 0 else ${timeEntries.minutes} end), 0)::int`;

// --- Planification -----------------------------------------------------------------------------

/** Tout ce que le calcul de charge lit : projets signés encore ouverts, tâches ouvertes, équipe. */
export async function loadPlanningData(db: Database, since: string): Promise<PlanningData> {
  const loggedByProject = db
    .select({ projectId: timeEntries.projectId, minutes: minutesSum.as("logged_minutes") })
    .from(timeEntries)
    .groupBy(timeEntries.projectId)
    .as("logged_by_project");
  const loggedByTask = db
    .select({ taskId: timeEntries.taskId, minutes: minutesSum.as("logged_minutes") })
    .from(timeEntries)
    .groupBy(timeEntries.taskId)
    .as("logged_by_task");

  const [members, absences, openProjects, openTasks] = await Promise.all([
    db
      .select({
        id: teamMembers.id,
        fullName: teamMembers.fullName,
        kind: teamMembers.kind,
        title: teamMembers.title,
        weeklyCapacityMinutes: teamMembers.weeklyCapacityMinutes,
      })
      .from(teamMembers)
      .where(and(eq(teamMembers.status, "active"), isNull(teamMembers.archivedAt)))
      .orderBy(asc(teamMembers.fullName)),
    db
      .select({
        memberId: memberAbsences.memberId,
        startOn: memberAbsences.startOn,
        endOn: memberAbsences.endOn,
      })
      .from(memberAbsences)
      .where(gte(memberAbsences.endOn, since)),
    db
      .select({
        id: projects.id,
        startOn: projects.startOn,
        dueOn: projects.dueOn,
        estimatedMinutes: projects.estimatedMinutes,
        ownerMemberId: projects.ownerMemberId,
        logged: loggedByProject.minutes,
      })
      .from(projects)
      .leftJoin(loggedByProject, eq(loggedByProject.projectId, projects.id))
      .where(
        and(isNull(projects.archivedAt), notInArray(projects.status, [...CLOSED_PROJECT_STATUSES])),
      ),
    db
      .select({
        projectId: tasks.projectId,
        assigneeMemberId: tasks.assigneeMemberId,
        dueOn: tasks.dueOn,
        estimatedMinutes: tasks.estimatedMinutes,
        logged: loggedByTask.minutes,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(loggedByTask, eq(loggedByTask.taskId, tasks.id))
      .where(
        and(
          isNull(tasks.archivedAt),
          ne(tasks.status, "done"),
          isNull(projects.archivedAt),
          notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
          // Une tâche mère n'ajoute rien à ses sous-tâches.
          sql`not exists (select 1 from ${tasks} as child where child.parent_task_id = ${tasks.id} and child.archived_at is null)`,
        ),
      ),
  ]);

  const projectIds = openProjects.map((project) => project.id);
  const links =
    projectIds.length === 0
      ? []
      : await db
          .select({ projectId: projectMembers.projectId, memberId: projectMembers.memberId })
          .from(projectMembers)
          .where(inArray(projectMembers.projectId, projectIds));
  const membersByProject = new Map<string, string[]>();
  for (const link of links) {
    membersByProject.set(link.projectId, [
      ...(membersByProject.get(link.projectId) ?? []),
      link.memberId,
    ]);
  }

  return {
    members,
    absences,
    projects: openProjects.map((project) => ({
      id: project.id,
      startOn: project.startOn,
      dueOn: project.dueOn,
      ownerMemberId: project.ownerMemberId,
      memberIds: membersByProject.get(project.id) ?? [],
      remainingMinutes: Math.max(0, (project.estimatedMinutes ?? 0) - (project.logged ?? 0)),
    })),
    tasks: openTasks.map((task) => ({
      projectId: task.projectId,
      assigneeMemberId: task.assigneeMemberId,
      dueOn: task.dueOn,
      remainingMinutes: Math.max(0, (task.estimatedMinutes ?? 0) - (task.logged ?? 0)),
    })),
  };
}

export async function sumMinutesByMember(
  db: Database,
  range: DayRange,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ memberId: timeEntries.memberId, minutes: minutesSum })
    .from(timeEntries)
    .where(and(gte(timeEntries.workOn, range.from), lte(timeEntries.workOn, range.to)))
    .groupBy(timeEntries.memberId);
  return new Map(rows.map((row) => [row.memberId, row.minutes]));
}

export async function sumMinutesByDay(db: Database, range: DayRange): Promise<Map<string, number>> {
  const rows = await db
    .select({ day: timeEntries.workOn, minutes: minutesSum })
    .from(timeEntries)
    .where(and(gte(timeEntries.workOn, range.from), lte(timeEntries.workOn, range.to)))
    .groupBy(timeEntries.workOn);
  return new Map(rows.map((row) => [row.day, row.minutes]));
}

// --- Totaux pour les autres modules ------------------------------------------------------------

export interface TimeTotalsRow {
  minutes: number;
  billableMinutes: number;
  costCents: number;
}

function totalsSelection() {
  return { minutes: minutesSum, billableMinutes: billableSum, costCents: costSum };
}

function normalizeTotals(row: TimeTotalsRow | undefined): TimeTotalsRow {
  return {
    minutes: row?.minutes ?? 0,
    billableMinutes: row?.billableMinutes ?? 0,
    costCents: Number(row?.costCents ?? 0),
  };
}

function periodFilter(period?: DayRange | null): SQL | undefined {
  if (!period) return undefined;
  return and(gte(timeEntries.workOn, period.from), lte(timeEntries.workOn, period.to));
}

export async function sumTimeForProject(
  db: Database,
  projectId: string,
  period?: DayRange | null,
): Promise<TimeTotalsRow> {
  const [row] = await db
    .select(totalsSelection())
    .from(timeEntries)
    .where(and(eq(timeEntries.projectId, projectId), periodFilter(period)));
  return normalizeTotals(row);
}

export async function sumTimeForCompany(
  db: Database,
  companyId: string,
  period?: DayRange | null,
): Promise<TimeTotalsRow> {
  const [row] = await db
    .select(totalsSelection())
    .from(timeEntries)
    .where(and(eq(timeEntries.companyId, companyId), periodFilter(period)));
  return normalizeTotals(row);
}

export async function sumTimeForContract(
  db: Database,
  contractId: string,
  period?: DayRange | null,
): Promise<TimeTotalsRow> {
  const [row] = await db
    .select(totalsSelection())
    .from(timeEntries)
    .where(and(eq(timeEntries.contractId, contractId), periodFilter(period)));
  return normalizeTotals(row);
}

/**
 * Une saisie n'a pas de site : elle lui revient par son ticket ; sinon, sans ticket, par le projet
 * de création du site ; sinon, ni ticket ni projet, par le contrat principal du site. Une même saisie
 * ne compte ainsi que pour un seul site quand les rattachements sont cohérents.
 */
export async function sumTimeForSite(
  db: Database,
  siteId: string,
  period?: DayRange | null,
): Promise<TimeTotalsRow> {
  const [site] = await db
    .select({ projectId: sites.projectId, contractId: sites.contractId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!site) return normalizeTotals(undefined);

  const [row] = await db
    .select(totalsSelection())
    .from(timeEntries)
    .leftJoin(tickets, eq(tickets.id, timeEntries.ticketId))
    .where(
      and(
        or(
          eq(tickets.siteId, siteId),
          site.projectId
            ? and(isNull(timeEntries.ticketId), eq(timeEntries.projectId, site.projectId))
            : undefined,
          site.contractId
            ? and(
                isNull(timeEntries.ticketId),
                isNull(timeEntries.projectId),
                eq(timeEntries.contractId, site.contractId),
              )
            : undefined,
        ),
        periodFilter(period),
      ),
    );
  return normalizeTotals(row);
}

export async function getProjectEnvelope(
  db: Database,
  projectId: string,
): Promise<{ estimatedMinutes: number | null; budgetCents: number | null } | null> {
  const [row] = await db
    .select({ estimatedMinutes: projects.estimatedMinutes, budgetCents: projects.budgetCents })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

// --- Saisies -----------------------------------------------------------------------------------

const entrySelection = {
  id: timeEntries.id,
  memberId: timeEntries.memberId,
  memberName: teamMembers.fullName,
  companyId: timeEntries.companyId,
  companyName: companies.name,
  projectId: timeEntries.projectId,
  projectName: projects.name,
  projectNumber: projects.number,
  taskId: timeEntries.taskId,
  taskTitle: tasks.title,
  ticketId: timeEntries.ticketId,
  ticketNumber: tickets.number,
  ticketSubject: tickets.subject,
  contractId: timeEntries.contractId,
  contractName: contracts.name,
  contractNumber: contracts.number,
  workOn: timeEntries.workOn,
  minutes: timeEntries.minutes,
  category: timeEntries.category,
  billable: timeEntries.billable,
  hourlyCostCents: timeEntries.hourlyCostCents,
  note: timeEntries.note,
  createdBy: timeEntries.createdBy,
  createdAt: timeEntries.createdAt,
  updatedAt: timeEntries.updatedAt,
};

export type TimeEntryRow = {
  id: string;
  memberId: string;
  memberName: string;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  taskId: string | null;
  taskTitle: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  ticketSubject: string | null;
  contractId: string | null;
  contractName: string | null;
  contractNumber: string | null;
  workOn: string;
  minutes: number;
  category: TimeCategory;
  billable: boolean;
  hourlyCostCents: number;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function entriesQuery(db: Database) {
  return db
    .select(entrySelection)
    .from(timeEntries)
    .innerJoin(teamMembers, eq(teamMembers.id, timeEntries.memberId))
    .leftJoin(companies, eq(companies.id, timeEntries.companyId))
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .leftJoin(tickets, eq(tickets.id, timeEntries.ticketId))
    .leftJoin(contracts, eq(contracts.id, timeEntries.contractId));
}

export interface TimeEntryFilters {
  memberId?: string;
  companyId?: string;
  projectId?: string;
  category?: TimeCategory;
  billable?: boolean;
  from?: string;
  to?: string;
  search?: string;
}

function entryWhere(filters: TimeEntryFilters): SQL | undefined {
  const search = filters.search?.trim();
  return and(
    filters.memberId ? eq(timeEntries.memberId, filters.memberId) : undefined,
    filters.companyId ? eq(timeEntries.companyId, filters.companyId) : undefined,
    filters.projectId ? eq(timeEntries.projectId, filters.projectId) : undefined,
    filters.category ? eq(timeEntries.category, filters.category) : undefined,
    filters.billable === undefined ? undefined : eq(timeEntries.billable, filters.billable),
    filters.from ? gte(timeEntries.workOn, filters.from) : undefined,
    filters.to ? lte(timeEntries.workOn, filters.to) : undefined,
    search
      ? or(
          ilike(companies.name, `%${search}%`),
          ilike(projects.name, `%${search}%`),
          ilike(tasks.title, `%${search}%`),
          ilike(tickets.subject, `%${search}%`),
          ilike(timeEntries.note, `%${search}%`),
          ilike(teamMembers.fullName, `%${search}%`),
        )
      : undefined,
  );
}

export function listEntries(
  db: Database,
  filters: TimeEntryFilters,
  limit: number,
  offset: number,
): Promise<TimeEntryRow[]> {
  return entriesQuery(db)
    .where(entryWhere(filters))
    .orderBy(desc(timeEntries.workOn), desc(timeEntries.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countEntries(db: Database, filters: TimeEntryFilters): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(timeEntries)
    .innerJoin(teamMembers, eq(teamMembers.id, timeEntries.memberId))
    .leftJoin(companies, eq(companies.id, timeEntries.companyId))
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .leftJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .leftJoin(tickets, eq(tickets.id, timeEntries.ticketId))
    .where(entryWhere(filters));
  return row?.total ?? 0;
}

export async function getEntry(db: Database, id: string): Promise<TimeEntryRow | null> {
  const [row] = await entriesQuery(db).where(eq(timeEntries.id, id)).limit(1);
  return row ?? null;
}

export function listMemberEntriesBetween(
  db: Database,
  memberId: string,
  range: DayRange,
): Promise<TimeEntryRow[]> {
  return entriesQuery(db)
    .where(
      and(
        eq(timeEntries.memberId, memberId),
        gte(timeEntries.workOn, range.from),
        lte(timeEntries.workOn, range.to),
      ),
    )
    .orderBy(asc(timeEntries.createdAt));
}

export type TimeEntryInsert = typeof timeEntries.$inferInsert;

export async function insertEntry(db: Database, values: TimeEntryInsert) {
  const [row] = await db.insert(timeEntries).values(values).returning();
  if (!row) throw new Error("Saisie de temps non créée");
  return row;
}

export async function updateEntry(db: Database, id: string, values: Partial<TimeEntryInsert>) {
  const [row] = await db
    .update(timeEntries)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(timeEntries.id, id))
    .returning();
  if (!row) throw new Error("Saisie de temps non modifiée");
  return row;
}

export async function deleteEntry(db: Database, id: string): Promise<void> {
  await db.delete(timeEntries).where(eq(timeEntries.id, id));
}

/** Verrou le temps de la transaction : deux enregistrements d'une même cellule passent l'un après l'autre. */
export async function lockKey(db: Database, key: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export interface EntryIdentity {
  memberId: string;
  workOn: string;
  category: TimeCategory;
  billable: boolean;
  projectId: string | null;
  taskId: string | null;
  ticketId: string | null;
  contractId: string | null;
}

function nullableEq(
  column:
    | typeof timeEntries.projectId
    | typeof timeEntries.taskId
    | typeof timeEntries.ticketId
    | typeof timeEntries.contractId,
  value: string | null,
): SQL {
  return value ? eq(column, value) : isNull(column);
}

/** Saisies d'une cellule de feuille de temps, de la plus ancienne à la plus récente. */
export function listCellEntries(db: Database, cell: EntryIdentity) {
  return db
    .select({
      id: timeEntries.id,
      minutes: timeEntries.minutes,
      hourlyCostCents: timeEntries.hourlyCostCents,
      companyId: timeEntries.companyId,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.memberId, cell.memberId),
        eq(timeEntries.workOn, cell.workOn),
        eq(timeEntries.category, cell.category),
        eq(timeEntries.billable, cell.billable),
        nullableEq(timeEntries.projectId, cell.projectId),
        nullableEq(timeEntries.taskId, cell.taskId),
        nullableEq(timeEntries.ticketId, cell.ticketId),
        nullableEq(timeEntries.contractId, cell.contractId),
      ),
    )
    .orderBy(asc(timeEntries.createdAt), asc(timeEntries.id));
}

export async function sumMemberDay(
  db: Database,
  memberId: string,
  workOn: string,
  excludingIds: readonly string[] = [],
): Promise<number> {
  const [row] = await db
    .select({ minutes: minutesSum })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.memberId, memberId),
        eq(timeEntries.workOn, workOn),
        excludingIds.length > 0 ? notInArray(timeEntries.id, [...excludingIds]) : undefined,
      ),
    );
  return row?.minutes ?? 0;
}

/** Même saisie enregistrée par le même compte dans la fenêtre : un double envoi, pas un nouveau temps. */
export async function findRecentDuplicate(
  db: Database,
  values: EntryIdentity & { minutes: number; note: string | null; createdBy: string },
  since: Date,
): Promise<string | null> {
  const [row] = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.memberId, values.memberId),
        eq(timeEntries.workOn, values.workOn),
        eq(timeEntries.minutes, values.minutes),
        eq(timeEntries.category, values.category),
        eq(timeEntries.billable, values.billable),
        eq(timeEntries.createdBy, values.createdBy),
        nullableEq(timeEntries.projectId, values.projectId),
        nullableEq(timeEntries.taskId, values.taskId),
        nullableEq(timeEntries.ticketId, values.ticketId),
        nullableEq(timeEntries.contractId, values.contractId),
        values.note ? eq(timeEntries.note, values.note) : isNull(timeEntries.note),
        gte(timeEntries.createdAt, since),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// --- Rattachements et périmètre ----------------------------------------------------------------

export async function getProjectLink(db: Database, id: string) {
  const [row] = await db
    .select({ id: projects.id, companyId: projects.companyId, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, id), isNull(projects.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function getTaskLink(db: Database, id: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      companyId: projects.companyId,
      assigneeMemberId: tasks.assigneeMemberId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, id), isNull(tasks.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function getTicketLink(db: Database, id: string) {
  const [row] = await db
    .select({
      id: tickets.id,
      companyId: tickets.companyId,
      projectId: tickets.projectId,
      contractId: tickets.contractId,
      assigneeMemberId: tickets.assigneeMemberId,
    })
    .from(tickets)
    .where(and(eq(tickets.id, id), isNull(tickets.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function getContractLink(db: Database, id: string) {
  const [row] = await db
    .select({ id: contracts.id, companyId: contracts.companyId })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  return row ?? null;
}

/** Tâche attribuée : responsable, mission sur la tâche, ou membre du projet. */
export async function isTaskAssignedToMember(
  db: Database,
  memberId: string,
  task: { id: string; projectId: string; assigneeMemberId: string | null },
): Promise<boolean> {
  if (task.assigneeMemberId === memberId) return true;
  const [viaMission, viaProject] = await Promise.all([
    db
      .select({ id: missions.id })
      .from(missions)
      .where(
        and(
          eq(missions.memberId, memberId),
          eq(missions.taskId, task.id),
          ne(missions.status, "cancelled"),
        ),
      )
      .limit(1),
    db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(eq(projectMembers.memberId, memberId), eq(projectMembers.projectId, task.projectId)),
      )
      .limit(1),
  ]);
  return viaMission.length > 0 || viaProject.length > 0;
}

export async function isTicketAssignedToMember(
  db: Database,
  memberId: string,
  ticket: { id: string; assigneeMemberId: string | null },
): Promise<boolean> {
  if (ticket.assigneeMemberId === memberId) return true;
  const rows = await db
    .select({ id: missions.id })
    .from(missions)
    .where(
      and(
        eq(missions.memberId, memberId),
        eq(missions.ticketId, ticket.id),
        ne(missions.status, "cancelled"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Contrat attribué : intervention confiée au membre, ou ticket attribué sur ce contrat. */
export async function isContractAssignedToMember(
  db: Database,
  memberId: string,
  contractId: string,
): Promise<boolean> {
  const [intervention, ticket] = await Promise.all([
    db
      .select({ id: maintenanceInterventions.id })
      .from(maintenanceInterventions)
      .where(
        and(
          eq(maintenanceInterventions.memberId, memberId),
          eq(maintenanceInterventions.contractId, contractId),
        ),
      )
      .limit(1),
    db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.assigneeMemberId, memberId), eq(tickets.contractId, contractId)))
      .limit(1),
  ]);
  return intervention.length > 0 || ticket.length > 0;
}

// --- Listes de choix ---------------------------------------------------------------------------

const OPTION_LIMIT = 200;

export interface WorkOption {
  id: string;
  label: string;
  companyId: string;
  companyName: string;
}

export async function listProjectOptions(
  db: Database,
  scope: { projectIds?: readonly string[] } = {},
): Promise<WorkOption[]> {
  if (scope.projectIds && scope.projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      number: projects.number,
      companyId: projects.companyId,
      companyName: companies.name,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(
      and(
        isNull(projects.archivedAt),
        notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
        scope.projectIds ? inArray(projects.id, [...scope.projectIds]) : undefined,
      ),
    )
    .orderBy(asc(companies.name), asc(projects.name))
    .limit(OPTION_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    label: `${row.companyName} · ${row.name}`,
    companyId: row.companyId,
    companyName: row.companyName,
  }));
}

export async function listTaskOptions(
  db: Database,
  projectId: string,
  scope: { memberId?: string } = {},
): Promise<{ id: string; label: string }[]> {
  const rows = await db
    .select({ id: tasks.id, number: tasks.number, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNull(tasks.archivedAt),
        ne(tasks.status, "done"),
        scope.memberId
          ? or(
              eq(tasks.assigneeMemberId, scope.memberId),
              sql`exists (select 1 from ${missions} where ${missions.taskId} = ${tasks.id} and ${missions.memberId} = ${scope.memberId} and ${missions.status} <> 'cancelled')`,
              sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${tasks.projectId} and ${projectMembers.memberId} = ${scope.memberId})`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(tasks.position), asc(tasks.title))
    .limit(OPTION_LIMIT);
  return rows.map((row) => ({ id: row.id, label: row.title }));
}

export async function listTicketOptions(
  db: Database,
  scope: { memberId?: string } = {},
): Promise<WorkOption[]> {
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      companyId: tickets.companyId,
      companyName: companies.name,
    })
    .from(tickets)
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .where(
      and(
        isNull(tickets.archivedAt),
        notInArray(tickets.status, [...CLOSED_TICKET_STATUSES]),
        scope.memberId
          ? or(
              eq(tickets.assigneeMemberId, scope.memberId),
              sql`exists (select 1 from ${missions} where ${missions.ticketId} = ${tickets.id} and ${missions.memberId} = ${scope.memberId} and ${missions.status} <> 'cancelled')`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(OPTION_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    label: `${row.number} · ${row.subject}`,
    companyId: row.companyId,
    companyName: row.companyName,
  }));
}

export async function listContractOptions(
  db: Database,
  scope: { memberId?: string } = {},
): Promise<WorkOption[]> {
  const rows = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      name: contracts.name,
      companyId: contracts.companyId,
      companyName: companies.name,
    })
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .where(
      and(
        inArray(contracts.status, [...OPEN_CONTRACT_STATUSES]),
        scope.memberId
          ? or(
              sql`exists (select 1 from ${maintenanceInterventions} where ${maintenanceInterventions.contractId} = ${contracts.id} and ${maintenanceInterventions.memberId} = ${scope.memberId})`,
              sql`exists (select 1 from ${tickets} where ${tickets.contractId} = ${contracts.id} and ${tickets.assigneeMemberId} = ${scope.memberId})`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(companies.name), asc(contracts.name))
    .limit(OPTION_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    label: `${row.companyName} · ${row.name}`,
    companyId: row.companyId,
    companyName: row.companyName,
  }));
}

/** Projets ouverts sur lesquels un membre travaille : les lignes par défaut de sa feuille de temps. */
export function listMemberOpenProjects(db: Database, memberId: string) {
  return db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      companyId: projects.companyId,
      companyName: companies.name,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(
      and(
        isNull(projects.archivedAt),
        notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
        or(
          eq(projects.ownerMemberId, memberId),
          sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.memberId} = ${memberId})`,
          sql`exists (select 1 from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.assigneeMemberId} = ${memberId} and ${tasks.status} <> 'done' and ${tasks.archivedAt} is null)`,
          sql`exists (select 1 from ${missions} where ${missions.projectId} = ${projects.id} and ${missions.memberId} = ${memberId} and ${inArray(missions.status, [...OPEN_MISSION_STATUSES])})`,
        ),
      ),
    )
    .orderBy(asc(companies.name), asc(projects.name))
    .limit(20);
}

export async function getMemberForEntry(db: Database, id: string) {
  const [row] = await db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      kind: teamMembers.kind,
      fullName: teamMembers.fullName,
      status: teamMembers.status,
      archivedAt: teamMembers.archivedAt,
      hourlyCostCents: teamMembers.hourlyCostCents,
    })
    .from(teamMembers)
    .where(eq(teamMembers.id, id))
    .limit(1);
  return row ?? null;
}

export function listSheetMembers(db: Database) {
  return db
    .select({ id: teamMembers.id, fullName: teamMembers.fullName, kind: teamMembers.kind })
    .from(teamMembers)
    .where(and(eq(teamMembers.status, "active"), isNull(teamMembers.archivedAt)))
    .orderBy(asc(teamMembers.fullName));
}

// --- Analyses ----------------------------------------------------------------------------------

export function sumWeekByMember(db: Database, range: DayRange, memberId?: string) {
  return db
    .select({
      memberId: timeEntries.memberId,
      fullName: teamMembers.fullName,
      minutes: minutesSum,
    })
    .from(timeEntries)
    .innerJoin(teamMembers, eq(teamMembers.id, timeEntries.memberId))
    .where(
      and(
        gte(timeEntries.workOn, range.from),
        lte(timeEntries.workOn, range.to),
        memberId ? eq(timeEntries.memberId, memberId) : undefined,
      ),
    )
    .groupBy(timeEntries.memberId, teamMembers.fullName)
    .orderBy(desc(minutesSum));
}

export function sumByCategory(db: Database, range: DayRange, memberId?: string) {
  return db
    .select({
      category: timeEntries.category,
      minutes: minutesSum,
      nonBillableMinutes: nonBillableSum,
    })
    .from(timeEntries)
    .where(
      and(
        gte(timeEntries.workOn, range.from),
        lte(timeEntries.workOn, range.to),
        memberId ? eq(timeEntries.memberId, memberId) : undefined,
      ),
    )
    .groupBy(timeEntries.category);
}

function loggedPerProject(db: Database) {
  return db
    .select({
      projectId: timeEntries.projectId,
      minutes: minutesSum.as("logged_minutes"),
      costCents: costSum.as("logged_cost_cents"),
    })
    .from(timeEntries)
    .groupBy(timeEntries.projectId)
    .as("logged");
}

function loggedPerTask(db: Database) {
  return db
    .select({ taskId: timeEntries.taskId, minutes: minutesSum.as("logged_minutes") })
    .from(timeEntries)
    .groupBy(timeEntries.taskId)
    .as("logged_task");
}

/** Estimé et consommé : projets terminés, puis tâches terminées des projets encore ouverts. */
export async function listEstimateComparisons(db: Database) {
  const logged = loggedPerProject(db);
  const loggedTask = loggedPerTask(db);
  const [finishedProjects, finishedTasks] = await Promise.all([
    db
      .select({ estimated: projects.estimatedMinutes, actual: logged.minutes })
      .from(projects)
      .innerJoin(logged, eq(logged.projectId, projects.id))
      .where(
        and(
          isNull(projects.archivedAt),
          inArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
          sql`${projects.estimatedMinutes} > 0`,
        ),
      ),
    db
      .select({ estimated: tasks.estimatedMinutes, actual: loggedTask.minutes })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(loggedTask, eq(loggedTask.taskId, tasks.id))
      .where(
        and(
          eq(tasks.status, "done"),
          isNull(tasks.archivedAt),
          isNull(projects.archivedAt),
          notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
          sql`${tasks.estimatedMinutes} > 0`,
        ),
      ),
  ]);
  return [...finishedProjects, ...finishedTasks].map((row) => ({
    estimated: row.estimated ?? 0,
    actual: row.actual,
  }));
}

/** Durées moyennes par prestation, sur les projets terminés : ce qu'on a vendu, ce qu'on a passé. */
export async function listActivityProductivity(db: Database) {
  const logged = loggedPerProject(db);
  const rows = await db
    .select({
      activity: projects.activity,
      projects: sql<number>`count(*)::int`,
      soldMinutes: sql<number>`round(avg(${projects.estimatedMinutes}))::int`,
      actualMinutes: sql<number>`round(avg(${logged.minutes}))::int`,
    })
    .from(projects)
    .innerJoin(logged, eq(logged.projectId, projects.id))
    .where(
      and(
        isNull(projects.archivedAt),
        inArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
        sql`${projects.activity} is not null`,
        sql`${projects.estimatedMinutes} > 0`,
      ),
    )
    .groupBy(projects.activity)
    .orderBy(asc(projects.activity));
  return rows.flatMap((row) => (row.activity ? [{ ...row, activity: row.activity }] : []));
}

const OVERRUN_LIMIT = 6;

/**
 * Projets ouverts à partir de `percent` % de leur enveloppe, tâches au-delà de leur estimation.
 * Avec `byBudget`, aussi les projets dont le coût du temps atteint ce seuil du budget : le critère
 * révèle un coût, il reste réservé à `team:read_costs`.
 */
export async function listOverruns(db: Database, percent: number, options: { byBudget: boolean }) {
  const logged = loggedPerProject(db);
  const loggedTask = loggedPerTask(db);
  const [overProjects, overTasks] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        companyName: companies.name,
        estimatedMinutes: projects.estimatedMinutes,
        budgetCents: projects.budgetCents,
        minutes: logged.minutes,
        costCents: logged.costCents,
      })
      .from(projects)
      .innerJoin(companies, eq(companies.id, projects.companyId))
      .innerJoin(logged, eq(logged.projectId, projects.id))
      .where(
        and(
          isNull(projects.archivedAt),
          notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
          or(
            sql`${projects.estimatedMinutes} > 0 and ${logged.minutes} * 100 >= ${projects.estimatedMinutes} * ${percent}`,
            options.byBudget
              ? sql`${projects.budgetCents} > 0 and ${logged.costCents} * 100 >= ${projects.budgetCents}::bigint * ${percent}`
              : undefined,
          ),
        ),
      )
      .orderBy(
        options.byBudget
          ? sql`greatest(${logged.minutes}::numeric / nullif(${projects.estimatedMinutes}, 0), ${logged.costCents}::numeric / nullif(${projects.budgetCents}, 0)) desc nulls last`
          : sql`${logged.minutes}::numeric / nullif(${projects.estimatedMinutes}, 0) desc nulls last`,
      )
      .limit(OVERRUN_LIMIT),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        projectId: tasks.projectId,
        projectName: projects.name,
        estimatedMinutes: tasks.estimatedMinutes,
        minutes: loggedTask.minutes,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(loggedTask, eq(loggedTask.taskId, tasks.id))
      .where(
        and(
          isNull(tasks.archivedAt),
          isNull(projects.archivedAt),
          notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]),
          sql`${tasks.estimatedMinutes} > 0`,
          sql`${loggedTask.minutes} > ${tasks.estimatedMinutes}`,
        ),
      )
      .orderBy(sql`${loggedTask.minutes}::numeric / ${tasks.estimatedMinutes} desc`)
      .limit(OVERRUN_LIMIT),
  ]);
  return { projects: overProjects, tasks: overTasks };
}
