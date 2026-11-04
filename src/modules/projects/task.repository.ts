import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  auditLog,
  companies,
  projects,
  taskDependencies,
  tasks,
  teamMembers,
  users,
  type Task,
  type TaskDependency,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import type { DependencyEdge } from "./project.rules";

/** Requêtes sur les tâches. Le périmètre d'un prestataire arrive en paramètre : `assigneeMemberId`. */

export interface TaskRow {
  id: string;
  number: string;
  projectId: string;
  phaseId: string | null;
  parentTaskId: string | null;
  title: string;
  status: Task["status"];
  priority: Task["priority"];
  assigneeMemberId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  estimatedMinutes: number | null;
  position: number;
}

const rowColumns = {
  id: tasks.id,
  number: tasks.number,
  projectId: tasks.projectId,
  phaseId: tasks.phaseId,
  parentTaskId: tasks.parentTaskId,
  title: tasks.title,
  status: tasks.status,
  priority: tasks.priority,
  assigneeMemberId: tasks.assigneeMemberId,
  assigneeName: teamMembers.fullName,
  dueOn: tasks.dueOn,
  estimatedMinutes: tasks.estimatedMinutes,
  position: tasks.position,
};

export async function listProjectTasks(
  db: Database,
  input: {
    projectId: string;
    /** Prestataire : seulement ses tâches. */
    assigneeMemberId: string | null;
    /** Vue d'ensemble : tâches de premier niveau, les sous-tâches se lisent dans la fenêtre. */
    rootsOnly: boolean;
    status?: Task["status"];
    search?: string;
    page: number;
    pageSize: number;
  },
): Promise<{ items: TaskRow[]; total: number }> {
  const search = input.search?.trim();
  const where = and(
    eq(tasks.projectId, input.projectId),
    isNull(tasks.archivedAt),
    input.assigneeMemberId ? eq(tasks.assigneeMemberId, input.assigneeMemberId) : undefined,
    input.rootsOnly ? isNull(tasks.parentTaskId) : undefined,
    input.status ? eq(tasks.status, input.status) : undefined,
    search ? or(ilike(tasks.title, `%${search}%`), ilike(tasks.number, `%${search}%`)) : undefined,
  );
  const [items, [counted]] = await Promise.all([
    db
      .select(rowColumns)
      .from(tasks)
      .leftJoin(teamMembers, eq(teamMembers.id, tasks.assigneeMemberId))
      .where(where)
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tasks)
      .where(where),
  ]);
  return { items, total: counted?.total ?? 0 };
}

export interface DependencyRow {
  taskId: string;
  dependsOnTaskId: string;
  title: string;
  status: Task["status"];
  dueOn: string | null;
}

/** Ce dont dépend chaque tâche demandée, pour la colonne DÉPEND DE. */
export async function dependenciesOf(
  db: Database,
  taskIds: readonly string[],
): Promise<DependencyRow[]> {
  if (taskIds.length === 0) return [];
  return db
    .select({
      taskId: taskDependencies.taskId,
      dependsOnTaskId: taskDependencies.dependsOnTaskId,
      title: tasks.title,
      status: tasks.status,
      dueOn: tasks.dueOn,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(and(inArray(taskDependencies.taskId, [...taskIds]), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.position));
}

export async function subtaskCounts(
  db: Database,
  taskIds: readonly string[],
): Promise<Map<string, { total: number; done: number }>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({
      parentTaskId: tasks.parentTaskId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
    })
    .from(tasks)
    .where(and(inArray(tasks.parentTaskId, [...taskIds]), isNull(tasks.archivedAt)))
    .groupBy(tasks.parentTaskId);
  return new Map(
    rows.flatMap((row) =>
      row.parentTaskId ? [[row.parentTaskId, { total: row.total, done: row.done }]] : [],
    ),
  );
}

export async function findTask(db: Database, taskId: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return row ?? null;
}

export interface TaskDetailRow {
  task: Task;
  assigneeName: string | null;
  assigneeTitle: string | null;
  projectNumber: string;
  projectName: string;
  projectStatus: string;
  companyId: string;
  companyName: string;
  parentTitle: string | null;
}

const parentTasks = aliasedTable(tasks, "parent_task");

export async function findTaskDetail(db: Database, taskId: string): Promise<TaskDetailRow | null> {
  const [row] = await db
    .select({
      task: tasks,
      assigneeName: teamMembers.fullName,
      assigneeTitle: teamMembers.title,
      projectNumber: projects.number,
      projectName: projects.name,
      projectStatus: projects.status,
      companyId: projects.companyId,
      companyName: companies.name,
      parentTitle: parentTasks.title,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .leftJoin(teamMembers, eq(teamMembers.id, tasks.assigneeMemberId))
    .leftJoin(parentTasks, eq(parentTasks.id, tasks.parentTaskId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row ?? null;
}

export async function listSubtasks(
  db: Database,
  input: { parentTaskId: string; assigneeMemberId: string | null },
): Promise<TaskRow[]> {
  return db
    .select(rowColumns)
    .from(tasks)
    .leftJoin(teamMembers, eq(teamMembers.id, tasks.assigneeMemberId))
    .where(
      and(
        eq(tasks.parentTaskId, input.parentTaskId),
        isNull(tasks.archivedAt),
        input.assigneeMemberId ? eq(tasks.assigneeMemberId, input.assigneeMemberId) : undefined,
      ),
    )
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
}

export async function insertTask(tx: Database, values: typeof tasks.$inferInsert): Promise<Task> {
  const [row] = await tx.insert(tasks).values(values).returning();
  if (!row) throw new Error("Tâche non créée.");
  return row;
}

export async function updateTask(
  tx: Database,
  taskId: string,
  values: Partial<typeof tasks.$inferInsert>,
): Promise<Task> {
  const [row] = await tx
    .update(tasks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!row) throw new Error("Tâche non modifiée.");
  return row;
}

export async function archiveSubtasks(tx: Database, parentTaskId: string, at: Date): Promise<void> {
  await tx
    .update(tasks)
    .set({ archivedAt: at, updatedAt: at })
    .where(and(eq(tasks.parentTaskId, parentTaskId), isNull(tasks.archivedAt)));
}

export async function nextTaskPosition(tx: Database, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ last: sql<number>`coalesce(max(${tasks.position}), 0)::int` })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
  return (row?.last ?? 0) + 1;
}

/** Titres et états des tâches d'un projet : liste de choix des dépendances. */
export async function listTaskOptions(
  db: Database,
  input: { projectId: string; excludeTaskId: string },
): Promise<{ id: string; number: string; title: string; status: Task["status"] }[]> {
  return db
    .select({ id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, input.projectId),
        isNull(tasks.archivedAt),
        ne(tasks.id, input.excludeTaskId),
      ),
    )
    .orderBy(asc(tasks.position))
    .limit(500);
}

export async function listProjectEdges(db: Database, projectId: string): Promise<DependencyEdge[]> {
  return db
    .select({
      taskId: taskDependencies.taskId,
      dependsOnTaskId: taskDependencies.dependsOnTaskId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(eq(tasks.projectId, projectId));
}

/** `null` : la dépendance existait déjà. */
export async function insertDependency(
  tx: Database,
  input: { taskId: string; dependsOnTaskId: string },
): Promise<TaskDependency | null> {
  const [row] = await tx
    .insert(taskDependencies)
    .values(input)
    .onConflictDoNothing({
      target: [taskDependencies.taskId, taskDependencies.dependsOnTaskId],
    })
    .returning();
  return row ?? null;
}

export async function deleteDependency(
  tx: Database,
  input: { taskId: string; dependsOnTaskId: string },
): Promise<boolean> {
  const rows = await tx
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.taskId, input.taskId),
        eq(taskDependencies.dependsOnTaskId, input.dependsOnTaskId),
      ),
    )
    .returning({ id: taskDependencies.id });
  return rows.length > 0;
}

/** Ce qui empêche de terminer : dépendances et sous-tâches pas encore faites. */
export async function unfinishedPrerequisites(
  db: Database,
  taskId: string,
): Promise<{ dependencies: string[]; subtasks: string[] }> {
  const [dependencies, subtasks] = await Promise.all([
    db
      .select({ title: tasks.title })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          ne(tasks.status, "done"),
          isNull(tasks.archivedAt),
        ),
      ),
    db
      .select({ title: tasks.title })
      .from(tasks)
      .where(
        and(eq(tasks.parentTaskId, taskId), ne(tasks.status, "done"), isNull(tasks.archivedAt)),
      ),
  ]);
  return {
    dependencies: dependencies.map((row) => row.title),
    subtasks: subtasks.map((row) => row.title),
  };
}

export interface OverdueTaskRow {
  id: string;
  number: string;
  title: string;
  projectId: string;
  projectNumber: string;
  companyId: string;
  dueOn: string;
  status: Task["status"];
  assigneeMemberId: string | null;
  assigneeUserId: string | null;
  ownerMemberId: string | null;
}

/** Tâches ouvertes dont l'échéance est passée, sur les projets encore en production. */
export async function listOverdueTasks(db: Database, today: string): Promise<OverdueTaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      projectId: tasks.projectId,
      projectNumber: projects.number,
      companyId: projects.companyId,
      dueOn: tasks.dueOn,
      status: tasks.status,
      assigneeMemberId: tasks.assigneeMemberId,
      assigneeUserId: teamMembers.userId,
      ownerMemberId: projects.ownerMemberId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(teamMembers, eq(teamMembers.id, tasks.assigneeMemberId))
    .where(
      and(
        lt(tasks.dueOn, today),
        ne(tasks.status, "done"),
        isNull(tasks.archivedAt),
        isNull(projects.archivedAt),
        inArray(projects.status, ["preparation", "active", "blocked", "in_validation"]),
      ),
    )
    .orderBy(asc(tasks.dueOn));
  return rows.flatMap((row) => (row.dueOn ? [{ ...row, dueOn: row.dueOn }] : []));
}

// --- Historique --------------------------------------------------------------------------------

export interface AuditRow {
  id: string;
  action: string;
  occurredAt: Date;
  actorName: string | null;
  metadata: Record<string, unknown>;
}

export async function listEntityAudit(
  db: Database,
  input: { entityType: string; entityId: string; limit: number },
): Promise<AuditRow[]> {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      occurredAt: auditLog.occurredAt,
      actorName: users.name,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(and(eq(auditLog.entityType, input.entityType), eq(auditLog.entityId, input.entityId)))
    .orderBy(desc(auditLog.occurredAt))
    .limit(input.limit);
}

// --- Calendrier --------------------------------------------------------------------------------

export interface CalendarTaskRow {
  id: string;
  title: string;
  status: Task["status"];
  dueOn: string;
  projectId: string;
  projectName: string;
  companyName: string;
}

export async function listTasksDueBetween(
  db: Database,
  input: {
    from: string;
    to: string;
    projectIds: readonly string[] | null;
    assigneeMemberId: string | null;
    limit: number;
  },
): Promise<CalendarTaskRow[]> {
  if (input.projectIds !== null && input.projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueOn: tasks.dueOn,
      projectId: tasks.projectId,
      projectName: projects.name,
      companyName: companies.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(
      and(
        sql`${tasks.dueOn} between ${input.from} and ${input.to}`,
        isNull(tasks.archivedAt),
        isNull(projects.archivedAt),
        input.projectIds === null ? undefined : inArray(tasks.projectId, [...input.projectIds]),
        input.assigneeMemberId ? eq(tasks.assigneeMemberId, input.assigneeMemberId) : undefined,
      ),
    )
    .orderBy(asc(tasks.dueOn), asc(tasks.position))
    .limit(input.limit);
  return rows.flatMap((row) => (row.dueOn ? [{ ...row, dueOn: row.dueOn }] : []));
}
