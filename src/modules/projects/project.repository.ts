import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  catalogItems,
  clientRequirements,
  companies,
  documents,
  handoverChecklistItems,
  opportunities,
  projectBlockers,
  projectMembers,
  projectPhases,
  projects,
  quoteLines,
  quotes,
  quoteVersions,
  sites,
  tasks,
  teamMembers,
  templates,
  timeEntries,
  type Project,
  type ProjectPhase,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { EMPTY_TASK_TOTALS, type TaskTotals } from "./project.rules";
import type { ProjectListView } from "./project.schema";

/** Requêtes Drizzle du domaine : ni règle métier, ni contrôle d'accès. */

const OPEN_STATUSES = ["active", "blocked", "in_validation"] as const;

function scopeCondition(projectIds: readonly string[] | null): SQL | undefined {
  return projectIds === null ? undefined : inArray(projects.id, [...projectIds]);
}

function listConditions(input: {
  view: ProjectListView;
  today: string;
  search?: string;
  projectIds: readonly string[] | null;
}): (SQL | undefined)[] {
  const search = input.search?.trim();
  const needle = search ? `%${search}%` : null;
  return [
    scopeCondition(input.projectIds),
    input.view === "archived" ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt),
    input.view === "active" ? inArray(projects.status, [...OPEN_STATUSES]) : undefined,
    input.view === "upcoming" ? eq(projects.status, "preparation") : undefined,
    input.view === "delivered" ? inArray(projects.status, ["delivered", "closed"]) : undefined,
    input.view === "late"
      ? and(inArray(projects.status, [...OPEN_STATUSES]), lt(projects.dueOn, input.today))
      : undefined,
    needle
      ? or(
          ilike(projects.name, needle),
          ilike(projects.number, needle),
          ilike(companies.name, needle),
        )
      : undefined,
  ];
}

export interface ProjectListRow {
  id: string;
  number: string;
  name: string;
  companyId: string;
  companyName: string;
  activity: Project["activity"];
  status: Project["status"];
  priority: Project["priority"];
  startOn: string | null;
  dueOn: string | null;
  deliveredOn: string | null;
  estimatedMinutes: number | null;
  budgetCents: number | null;
  archivedAt: Date | null;
}

const listColumns = {
  id: projects.id,
  number: projects.number,
  name: projects.name,
  companyId: projects.companyId,
  companyName: companies.name,
  activity: projects.activity,
  status: projects.status,
  priority: projects.priority,
  startOn: projects.startOn,
  dueOn: projects.dueOn,
  deliveredOn: projects.deliveredOn,
  estimatedMinutes: projects.estimatedMinutes,
  budgetCents: projects.budgetCents,
  archivedAt: projects.archivedAt,
};

export async function listProjects(
  db: Database,
  input: {
    view: ProjectListView;
    today: string;
    search?: string;
    projectIds: readonly string[] | null;
    page: number;
    pageSize: number;
  },
): Promise<{ items: ProjectListRow[]; total: number }> {
  if (input.projectIds !== null && input.projectIds.length === 0) return { items: [], total: 0 };
  const where = and(...listConditions(input));
  const [items, [counted]] = await Promise.all([
    db
      .select(listColumns)
      .from(projects)
      .innerJoin(companies, eq(companies.id, projects.companyId))
      .where(where)
      .orderBy(
        input.view === "delivered"
          ? desc(projects.deliveredOn)
          : sql`${projects.dueOn} asc nulls last`,
        desc(projects.number),
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(projects)
      .innerJoin(companies, eq(companies.id, projects.companyId))
      .where(where),
  ]);
  return { items, total: counted?.total ?? 0 };
}

export async function countPortfolio(
  db: Database,
  input: { today: string; projectIds: readonly string[] | null },
): Promise<{ open: number; late: number; upcoming: number }> {
  if (input.projectIds !== null && input.projectIds.length === 0) {
    return { open: 0, late: 0, upcoming: 0 };
  }
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${projects.status} in ('active', 'blocked', 'in_validation'))::int`,
      late: sql<number>`count(*) filter (where ${projects.status} in ('active', 'blocked', 'in_validation') and ${projects.dueOn} < ${input.today})::int`,
      upcoming: sql<number>`count(*) filter (where ${projects.status} = 'preparation')::int`,
    })
    .from(projects)
    .where(and(isNull(projects.archivedAt), scopeCondition(input.projectIds)));
  return { open: row?.open ?? 0, late: row?.late ?? 0, upcoming: row?.upcoming ?? 0 };
}

/** Avancement par projet, sur les tâches de premier niveau : une sous-tâche détaille sa parente. */
export async function taskTotalsByProject(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, TaskTotals>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({
      projectId: tasks.projectId,
      taskCount: sql<number>`count(*)::int`,
      doneCount: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      estimatedMinutes: sql<number>`coalesce(sum(${tasks.estimatedMinutes}), 0)::int`,
      doneMinutes: sql<number>`coalesce(sum(${tasks.estimatedMinutes}) filter (where ${tasks.status} = 'done'), 0)::int`,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.projectId, [...projectIds]),
        isNull(tasks.archivedAt),
        isNull(tasks.parentTaskId),
      ),
    )
    .groupBy(tasks.projectId);
  return new Map(rows.map(({ projectId, ...totals }) => [projectId, totals]));
}

export async function taskTotalsForProject(db: Database, projectId: string): Promise<TaskTotals> {
  const totals = await taskTotalsByProject(db, [projectId]);
  return totals.get(projectId) ?? EMPTY_TASK_TOTALS;
}

export async function phasesByProject(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, ProjectPhase[]>> {
  const result = new Map<string, ProjectPhase[]>();
  if (projectIds.length === 0) return result;
  const rows = await db
    .select()
    .from(projectPhases)
    .where(and(inArray(projectPhases.projectId, [...projectIds]), isNull(projectPhases.archivedAt)))
    .orderBy(asc(projectPhases.position), asc(projectPhases.createdAt));
  for (const row of rows) {
    const list = result.get(row.projectId);
    if (list) list.push(row);
    else result.set(row.projectId, [row]);
  }
  return result;
}

export async function openBlockersByProject(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: projectBlockers.projectId, count: sql<number>`count(*)::int` })
    .from(projectBlockers)
    .where(
      and(inArray(projectBlockers.projectId, [...projectIds]), isNull(projectBlockers.resolvedAt)),
    )
    .groupBy(projectBlockers.projectId);
  return new Map(rows.map((row) => [row.projectId, row.count]));
}

export async function expectedRequirementsByProject(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: clientRequirements.projectId, count: sql<number>`count(*)::int` })
    .from(clientRequirements)
    .where(
      and(
        inArray(clientRequirements.projectId, [...projectIds]),
        isNull(clientRequirements.archivedAt),
        eq(clientRequirements.status, "expected"),
      ),
    )
    .groupBy(clientRequirements.projectId);
  return new Map(rows.map((row) => [row.projectId, row.count]));
}

export interface ProjectMemberRow {
  id: string;
  projectId: string;
  memberId: string;
  userId: string | null;
  fullName: string;
  title: string | null;
  kind: string;
  role: string | null;
}

export async function membersByProject(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, ProjectMemberRow[]>> {
  const result = new Map<string, ProjectMemberRow[]>();
  if (projectIds.length === 0) return result;
  const rows = await db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      memberId: projectMembers.memberId,
      userId: teamMembers.userId,
      fullName: teamMembers.fullName,
      title: teamMembers.title,
      kind: teamMembers.kind,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(teamMembers, eq(teamMembers.id, projectMembers.memberId))
    .where(inArray(projectMembers.projectId, [...projectIds]))
    .orderBy(asc(projectMembers.createdAt));
  for (const row of rows) {
    const list = result.get(row.projectId);
    if (list) list.push(row);
    else result.set(row.projectId, [row]);
  }
  return result;
}

export async function findProject(db: Database, projectId: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return row ?? null;
}

export async function findProjectByQuote(db: Database, quoteId: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.quoteId, quoteId)).limit(1);
  return row ?? null;
}

/** Verrou posé jusqu'à la fin de la transaction : sérialise les écritures d'un projet. */
export async function lockProject(tx: Database, projectId: string): Promise<Project | null> {
  const [row] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  return row ?? null;
}

export interface ProjectHeaderRow {
  project: Project;
  companyName: string;
  ownerName: string | null;
  quoteNumber: string | null;
}

export async function findProjectHeader(
  db: Database,
  projectId: string,
): Promise<ProjectHeaderRow | null> {
  const [row] = await db
    .select({
      project: projects,
      companyName: companies.name,
      ownerName: teamMembers.fullName,
      quoteNumber: quotes.number,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .leftJoin(teamMembers, eq(teamMembers.id, projects.ownerMemberId))
    .leftJoin(quotes, eq(quotes.id, projects.quoteId))
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

export async function insertProject(
  tx: Database,
  values: typeof projects.$inferInsert,
): Promise<Project> {
  const [row] = await tx.insert(projects).values(values).returning();
  if (!row) throw new Error("Projet non créé.");
  return row;
}

/** Insère sans lever si le devis a déjà son projet : `null` signale le doublon. */
export async function insertProjectFromQuote(
  tx: Database,
  values: typeof projects.$inferInsert,
): Promise<Project | null> {
  const [row] = await tx
    .insert(projects)
    .values(values)
    .onConflictDoNothing({
      target: projects.quoteId,
      where: sql`${projects.quoteId} is not null`,
    })
    .returning();
  return row ?? null;
}

export async function updateProject(
  tx: Database,
  projectId: string,
  values: Partial<typeof projects.$inferInsert>,
): Promise<Project> {
  const [row] = await tx
    .update(projects)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning();
  if (!row) throw new Error("Projet non modifié.");
  return row;
}

/** Vrai si le client existe et n'est pas archivé. */
export async function companyExists(db: Database, companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.archivedAt)))
    .limit(1);
  return Boolean(row);
}

export async function findActiveMember(
  db: Database,
  memberId: string,
): Promise<{ id: string; fullName: string } | null> {
  const [row] = await db
    .select({ id: teamMembers.id, fullName: teamMembers.fullName })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.id, memberId),
        eq(teamMembers.status, "active"),
        isNull(teamMembers.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// --- Devis d'origine ---------------------------------------------------------------------------

export interface QuoteSource {
  quoteId: string;
  companyId: string;
  status: string;
  title: string | null;
  number: string;
  versionQuoteId: string;
  scope: string | null;
  totalCents: number;
  estimatedMinutes: number | null;
}

export async function findQuoteSource(
  db: Database,
  input: { quoteId: string; versionId: string },
): Promise<QuoteSource | null> {
  const [row] = await db
    .select({
      quoteId: quotes.id,
      companyId: quotes.companyId,
      status: quotes.status,
      title: quotes.title,
      number: quotes.number,
      versionQuoteId: quoteVersions.quoteId,
      scope: quoteVersions.scope,
      totalCents: quoteVersions.totalCents,
      estimatedMinutes: quoteVersions.estimatedMinutes,
    })
    .from(quoteVersions)
    .innerJoin(quotes, eq(quotes.id, input.quoteId))
    .where(eq(quoteVersions.id, input.versionId))
    .limit(1);
  return row ?? null;
}

/** Activité de la première ligne « projet » du devis : détermine le plan. */
export async function findQuoteActivity(
  db: Database,
  versionId: string,
): Promise<Project["activity"]> {
  const [row] = await db
    .select({ activity: catalogItems.activity })
    .from(quoteLines)
    .innerJoin(catalogItems, eq(catalogItems.id, quoteLines.catalogItemId))
    .where(and(eq(quoteLines.quoteVersionId, versionId), eq(catalogItems.kind, "project")))
    .orderBy(asc(quoteLines.position))
    .limit(1);
  return row?.activity ?? null;
}

export async function findOpportunityOwner(
  db: Database,
  opportunityId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ ownerMemberId: opportunities.ownerMemberId })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  return row?.ownerMemberId ?? null;
}

// --- Modèles -----------------------------------------------------------------------------------

/** Modèle actif : celui de l'activité d'abord, à défaut un modèle commun à toutes les activités. */
export async function findTemplateItems(
  db: Database,
  kind: "project_plan" | "checklist",
  activity: Project["activity"],
): Promise<unknown[] | null> {
  const rows = await db
    .select({ activity: templates.activity, items: templates.items })
    .from(templates)
    .where(
      and(
        eq(templates.kind, kind),
        eq(templates.active, true),
        activity
          ? or(eq(templates.activity, activity), isNull(templates.activity))
          : isNull(templates.activity),
      ),
    )
    .orderBy(sql`${templates.activity} asc nulls last`, asc(templates.createdAt))
    .limit(1);
  return rows[0]?.items ?? null;
}

// --- Temps passé -------------------------------------------------------------------------------

export interface ProjectTimeTotals {
  spentMinutes: number;
  consumedCents: number;
}

export async function timeTotalsForProject(
  db: Database,
  projectId: string,
): Promise<ProjectTimeTotals> {
  const [row] = await db
    .select({
      spentMinutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
      consumedCents: sql<number>`coalesce(round(sum(${timeEntries.minutes} * ${timeEntries.hourlyCostCents}) / 60.0), 0)::int`,
    })
    .from(timeEntries)
    .where(eq(timeEntries.projectId, projectId));
  return { spentMinutes: row?.spentMinutes ?? 0, consumedCents: row?.consumedCents ?? 0 };
}

export interface BudgetSweepRow extends ProjectTimeTotals {
  projectId: string;
  companyId: string;
  budgetCents: number | null;
  estimatedMinutes: number | null;
}

/** Projets ouverts qui ont une enveloppe et du temps saisi : base de la vérification périodique. */
export async function listBudgetSweepRows(db: Database): Promise<BudgetSweepRow[]> {
  return db
    .select({
      projectId: projects.id,
      companyId: projects.companyId,
      budgetCents: projects.budgetCents,
      estimatedMinutes: projects.estimatedMinutes,
      spentMinutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int`,
      consumedCents: sql<number>`coalesce(round(sum(${timeEntries.minutes} * ${timeEntries.hourlyCostCents}) / 60.0), 0)::int`,
    })
    .from(projects)
    .innerJoin(timeEntries, eq(timeEntries.projectId, projects.id))
    .where(
      and(isNull(projects.archivedAt), inArray(projects.status, ["preparation", ...OPEN_STATUSES])),
    )
    .groupBy(projects.id);
}

// --- Rattachements -----------------------------------------------------------------------------

export interface ProjectSiteRow {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: string;
}

export async function listSitesOfProject(
  db: Database,
  projectId: string,
): Promise<ProjectSiteRow[]> {
  return db
    .select({
      id: sites.id,
      name: sites.name,
      primaryDomain: sites.primaryDomain,
      status: sites.status,
    })
    .from(sites)
    .where(and(eq(sites.projectId, projectId), isNull(sites.archivedAt)))
    .orderBy(asc(sites.name));
}

export interface ProjectDocumentRow {
  id: string;
  title: string;
  kind: string;
  visibility: string;
}

export async function listDocumentsOfProject(
  db: Database,
  projectId: string,
): Promise<ProjectDocumentRow[]> {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      kind: documents.kind,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.archivedAt)))
    .orderBy(asc(documents.title))
    .limit(200);
}

export async function documentBelongsToProject(
  db: Database,
  documentId: string,
  projectId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.projectId, projectId),
        isNull(documents.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// --- Passation ---------------------------------------------------------------------------------

export async function countOpenHandover(db: Database, projectId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(handoverChecklistItems)
    .where(
      and(
        eq(handoverChecklistItems.projectId, projectId),
        isNull(handoverChecklistItems.doneAt),
        isNull(handoverChecklistItems.archivedAt),
      ),
    );
  return row?.count ?? 0;
}

// --- Fiche client ------------------------------------------------------------------------------

export async function listProjectsOfCompany(
  db: Database,
  input: { companyId: string; projectIds: readonly string[] | null; limit: number },
): Promise<ProjectListRow[]> {
  if (input.projectIds !== null && input.projectIds.length === 0) return [];
  return db
    .select(listColumns)
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(
      and(
        eq(projects.companyId, input.companyId),
        isNull(projects.archivedAt),
        scopeCondition(input.projectIds),
      ),
    )
    .orderBy(desc(projects.createdAt))
    .limit(input.limit);
}

// --- Calendrier --------------------------------------------------------------------------------

export interface CalendarProjectRow {
  id: string;
  name: string;
  companyName: string;
  status: Project["status"];
  dueOn: string;
}

export async function listProjectsDueBetween(
  db: Database,
  input: { from: string; to: string; projectIds: readonly string[] | null; limit: number },
): Promise<CalendarProjectRow[]> {
  if (input.projectIds !== null && input.projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      companyName: companies.name,
      status: projects.status,
      dueOn: projects.dueOn,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(
      and(
        sql`${projects.dueOn} between ${input.from} and ${input.to}`,
        isNull(projects.archivedAt),
        scopeCondition(input.projectIds),
      ),
    )
    .orderBy(asc(projects.dueOn))
    .limit(input.limit);
  return rows.flatMap((row) => (row.dueOn ? [{ ...row, dueOn: row.dueOn }] : []));
}
