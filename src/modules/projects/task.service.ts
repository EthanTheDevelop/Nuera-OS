import { TASK_STATUS_LABELS } from "@/lib/domain-enums";
import { AUDIT_ACTIONS, type AuditAction } from "@/modules/audit/audit.constants";
import { recordAudit } from "@/modules/audit/audit.service";
import { listDocumentsFor } from "@/modules/documents/document.service";
import {
  addComment,
  listComments,
  listMentionCandidates,
  type CommentView,
  type MentionOption,
} from "@/modules/messaging/comment.service";
import { nextNumber } from "@/modules/platform/sequences";
import { listAssignableMembers, type MemberOption } from "@/modules/team/team.lookup";
import { assertCan, assertCanAny, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Task } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import {
  assertProjectEditable,
  lockEditableProject,
  requireReadableProject,
  resolveProjectScope,
} from "./project.access";
import * as repository from "./project.repository";
import { parisDay, projectTitle, wouldCreateCycle } from "./project.rules";
import {
  calendarRangeSchema,
  changeTaskStatusSchema,
  createTaskSchema,
  entityIdSchema,
  taskCommentSchema,
  taskDependencySchema,
  taskListSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type TaskCommentInput,
  type TaskListInput,
  type UpdateTaskInput,
} from "./project.schema";
import * as production from "./production.repository";
import {
  assertTaskTransition,
  canTaskTransition,
  TASK_STATUSES,
  type TaskStatus,
} from "./task.status";
import * as taskRepository from "./task.repository";

/** Tâche que l'acteur peut lire, sinon 404. Un prestataire ne voit que celles qui lui sont affectées. */
async function requireReadableTask(ctx: ServiceContext, taskId: string): Promise<Task> {
  assertCanAny(ctx.actor, ["tasks:read", "tasks:read_assigned"]);
  const task = await taskRepository.findTask(ctx.db, parseInput(entityIdSchema, taskId));
  if (!task || task.archivedAt) throw new NotFoundError("Tâche introuvable.");
  if (!can(ctx.actor, "tasks:read")) {
    // Sa tâche, sur un projet encore dans son périmètre : une fiche désactivée n'en a plus aucun.
    const scope = await resolveProjectScope(ctx);
    if (!scope.assigneeMemberId || task.assigneeMemberId !== scope.assigneeMemberId) {
      throw new NotFoundError("Tâche introuvable.");
    }
    try {
      await requireReadableProject(ctx, task.projectId);
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError("Tâche introuvable.");
      throw error;
    }
  }
  return task;
}

/** Tâche que l'acteur peut modifier : droit d'abord, périmètre ensuite. */
async function requireWritableTask(ctx: ServiceContext, taskId: string): Promise<Task> {
  assertCanAny(ctx.actor, ["tasks:update", "tasks:update_assigned"]);
  const task = await requireReadableTask(ctx, taskId);
  const project = await repository.findProject(ctx.db, task.projectId);
  if (!project) throw new NotFoundError("Tâche introuvable.");
  assertProjectEditable(project);
  return task;
}

async function assertAssignable(db: Database, memberId: string | null | undefined): Promise<void> {
  if (!memberId) return;
  const member = await repository.findActiveMember(db, memberId);
  if (!member) {
    throw new ValidationError("Cette personne n'est plus disponible.", {
      assigneeMemberId: ["Cette personne n'est plus disponible."],
    });
  }
}

async function assertPhaseInProject(
  db: Database,
  phaseId: string | null | undefined,
  projectId: string,
): Promise<void> {
  if (!phaseId) return;
  const phase = await production.findPhase(db, phaseId);
  if (!phase || phase.projectId !== projectId) {
    throw new ValidationError("Ce jalon n'appartient pas au projet.", {
      phaseId: ["Ce jalon n'appartient pas au projet."],
    });
  }
}

// --- Écritures ---------------------------------------------------------------------------------

export async function createTask(ctx: ServiceContext, input: CreateTaskInput): Promise<Task> {
  assertCan(ctx.actor, "tasks:create");
  const parsed = parseInput(createTaskSchema, input);
  const project = await requireReadableProject(ctx, parsed.projectId);
  assertProjectEditable(project);
  await assertPhaseInProject(ctx.db, parsed.phaseId, parsed.projectId);
  await assertAssignable(ctx.db, parsed.assigneeMemberId);

  let phaseId = parsed.phaseId ?? null;
  if (parsed.parentTaskId) {
    const parent = await taskRepository.findTask(ctx.db, parsed.parentTaskId);
    if (!parent || parent.projectId !== parsed.projectId || parent.archivedAt) {
      throw new ValidationError("Cette tâche parente n'appartient pas au projet.", {
        parentTaskId: ["Cette tâche parente n'appartient pas au projet."],
      });
    }
    if (parent.parentTaskId) {
      throw new ConflictError("Une sous-tâche ne peut pas avoir de sous-tâches.");
    }
    phaseId = phaseId ?? parent.phaseId;
  }

  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, parsed.projectId);
    const task = await taskRepository.insertTask(tx, {
      number: await nextNumber(tx, "task"),
      projectId: parsed.projectId,
      phaseId,
      parentTaskId: parsed.parentTaskId ?? null,
      title: parsed.title,
      description: parsed.description ?? null,
      priority: parsed.priority,
      assigneeMemberId: parsed.assigneeMemberId ?? null,
      dueOn: parsed.dueOn ?? null,
      estimatedMinutes: parsed.estimatedMinutes ?? null,
      position: await taskRepository.nextTaskPosition(tx, parsed.projectId),
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "task.created",
      entityType: "task",
      entityId: task.id,
      metadata: { number: task.number, title: task.title, projectId: task.projectId },
    });
    return task;
  });
}

const ASSIGNED_ONLY_FIELDS = new Set(["taskId", "description"]);

export async function updateTask(ctx: ServiceContext, input: UpdateTaskInput): Promise<Task> {
  assertCanAny(ctx.actor, ["tasks:update", "tasks:update_assigned"]);
  const { taskId, ...patch } = parseInput(updateTaskSchema, input);
  const task = await requireWritableTask(ctx, taskId);

  // Le prestataire tient sa tâche à jour, il ne la réaffecte ni ne la replanifie.
  if (!can(ctx.actor, "tasks:update")) {
    const refused = Object.entries(patch).some(
      ([key, value]) => value !== undefined && !ASSIGNED_ONLY_FIELDS.has(key),
    );
    if (refused) throw new ForbiddenError();
  }
  await assertPhaseInProject(ctx.db, patch.phaseId, task.projectId);
  await assertAssignable(ctx.db, patch.assigneeMemberId);

  const values = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<typeof patch>;
  if (Object.keys(values).length === 0) return task;

  const reassigned =
    patch.assigneeMemberId !== undefined && patch.assigneeMemberId !== task.assigneeMemberId;

  return ctx.db.transaction(async (tx) => {
    const updated = await taskRepository.updateTask(tx, taskId, values);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: reassigned ? "task.assigned" : "task.updated",
      entityType: "task",
      entityId: taskId,
      metadata: reassigned
        ? { from: task.assigneeMemberId, to: updated.assigneeMemberId }
        : { fields: Object.keys(values) },
    });
    return updated;
  });
}

export async function changeTaskStatus(
  ctx: ServiceContext,
  input: { taskId: string; status: TaskStatus },
): Promise<Task> {
  assertCanAny(ctx.actor, ["tasks:update", "tasks:update_assigned"]);
  const parsed = parseInput(changeTaskStatusSchema, input);
  const { projectId } = await requireWritableTask(ctx, parsed.taskId);

  return ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, projectId);
    const task = await taskRepository.findTask(tx, parsed.taskId);
    if (!task || task.archivedAt) throw new NotFoundError("Tâche introuvable.");
    if (task.status === parsed.status) return task;
    assertTaskTransition(task.status, parsed.status);

    if (parsed.status === "done") {
      const missing = await taskRepository.unfinishedPrerequisites(tx, task.id);
      if (missing.dependencies.length > 0) {
        throw new ConflictError(`Cette tâche dépend de : ${missing.dependencies.join(", ")}.`);
      }
      if (missing.subtasks.length > 0) {
        throw new ConflictError(`Sous-tâches à terminer : ${missing.subtasks.join(", ")}.`);
      }
    }

    const updated = await taskRepository.updateTask(tx, task.id, {
      status: parsed.status,
      completedAt: parsed.status === "done" ? new Date() : null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "task.status_changed",
      entityType: "task",
      entityId: task.id,
      metadata: { from: task.status, to: parsed.status },
    });
    return updated;
  });
}

export async function archiveTask(ctx: ServiceContext, taskId: string): Promise<void> {
  assertCan(ctx.actor, "tasks:update");
  const { projectId } = await requireWritableTask(ctx, taskId);
  await ctx.db.transaction(async (tx) => {
    await lockEditableProject(tx, projectId);
    const task = await taskRepository.findTask(tx, taskId);
    if (!task || task.archivedAt) return;
    const at = new Date();
    await taskRepository.archiveSubtasks(tx, taskId, at);
    await taskRepository.updateTask(tx, taskId, { archivedAt: at });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "task.archived",
      entityType: "task",
      entityId: taskId,
      metadata: { number: task.number, title: task.title },
    });
  });
}

/** Ajoute une dépendance. Répéter ne fait rien ; une boucle ou un autre projet sont refusés. */
export async function addTaskDependency(
  ctx: ServiceContext,
  input: { taskId: string; dependsOnTaskId: string },
): Promise<void> {
  assertCan(ctx.actor, "tasks:update");
  const parsed = parseInput(taskDependencySchema, input);
  const task = await requireWritableTask(ctx, parsed.taskId);
  const target = await requireReadableTask(ctx, parsed.dependsOnTaskId);
  if (target.projectId !== task.projectId) {
    throw new ConflictError("Une dépendance relie deux tâches du même projet.");
  }

  await ctx.db.transaction(async (tx) => {
    // Sérialise les ajouts sur ce projet : deux ajouts simultanés ne ferment pas de boucle.
    await repository.lockProject(tx, task.projectId);
    const edges = await taskRepository.listProjectEdges(tx, task.projectId);
    if (wouldCreateCycle(edges, parsed.taskId, parsed.dependsOnTaskId)) {
      throw new ConflictError("Cette dépendance créerait une boucle entre les tâches.");
    }
    const inserted = await taskRepository.insertDependency(tx, parsed);
    if (!inserted) return;
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "task_dependency.added",
      entityType: "task",
      entityId: parsed.taskId,
      metadata: { dependsOnTaskId: parsed.dependsOnTaskId, title: target.title },
    });
  });
}

export async function removeTaskDependency(
  ctx: ServiceContext,
  input: { taskId: string; dependsOnTaskId: string },
): Promise<void> {
  assertCan(ctx.actor, "tasks:update");
  const parsed = parseInput(taskDependencySchema, input);
  await requireWritableTask(ctx, parsed.taskId);
  await ctx.db.transaction(async (tx) => {
    const removed = await taskRepository.deleteDependency(tx, parsed);
    if (!removed) return;
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "task_dependency.removed",
      entityType: "task",
      entityId: parsed.taskId,
      metadata: { dependsOnTaskId: parsed.dependsOnTaskId },
    });
  });
}

/** Le droit de commenter suit celui de la tâche : le service de commentaires ne le vérifie pas. */
export async function addTaskComment(
  ctx: ServiceContext,
  input: TaskCommentInput,
): Promise<CommentView> {
  assertCanAny(ctx.actor, ["tasks:update", "tasks:update_assigned"]);
  const parsed = parseInput(taskCommentSchema, input);
  const task = await requireReadableTask(ctx, parsed.taskId);
  const project = await repository.findProject(ctx.db, task.projectId);
  if (!project) throw new NotFoundError("Tâche introuvable.");
  assertProjectEditable(project);
  if (parsed.documentId) {
    const attached = await repository.documentBelongsToProject(
      ctx.db,
      parsed.documentId,
      task.projectId,
    );
    if (!attached) throw new NotFoundError("Document introuvable.");
  }
  return addComment(ctx, {
    entityType: "task",
    entityId: task.id,
    companyId: project.companyId,
    body: parsed.body,
    mentions: parsed.mentions,
    documentId: parsed.documentId ?? undefined,
    parentId: parsed.parentId ?? undefined,
    clientRequestId: parsed.clientRequestId ?? undefined,
    href: `/projets/${task.projectId}?tache=${task.id}`,
  });
}

// --- Lectures ----------------------------------------------------------------------------------

export interface TaskListRow extends taskRepository.TaskRow {
  dependsOn: { id: string; title: string; status: TaskStatus }[];
  subtasks: { total: number; done: number } | null;
  /** Transitions autorisées pour cet acteur : vide s'il ne peut pas modifier la tâche. */
  nextStatuses: TaskStatus[];
}

export async function listTasks(
  ctx: ServiceContext,
  input: TaskListInput,
): Promise<{ items: TaskListRow[]; total: number; page: number; pageSize: number }> {
  assertCanAny(ctx.actor, ["tasks:read", "tasks:read_assigned"]);
  const parsed = parseInput(taskListSchema, input);
  const project = await requireReadableProject(ctx, parsed.projectId);
  const scope = await resolveProjectScope(ctx);
  // Une recherche ou un prestataire voient aussi les sous-tâches, à plat.
  const rootsOnly = !scope.assignedOnly && !parsed.search && !parsed.status;
  const { items, total } =
    scope.assignedOnly && !scope.assigneeMemberId
      ? { items: [], total: 0 }
      : await taskRepository.listProjectTasks(ctx.db, {
          projectId: parsed.projectId,
          assigneeMemberId: scope.assigneeMemberId,
          rootsOnly,
          status: parsed.status,
          search: parsed.search,
          page: parsed.page,
          pageSize: parsed.pageSize,
        });
  const ids = items.map((task) => task.id);
  const [dependencies, subtasks] = await Promise.all([
    taskRepository.dependenciesOf(ctx.db, ids),
    taskRepository.subtaskCounts(ctx.db, ids),
  ]);
  const writable = canAnyWrite(ctx) && project.archivedAt === null && project.status !== "closed";
  return {
    items: items.map((task) => ({
      ...task,
      dependsOn: dependencies
        .filter((row) => row.taskId === task.id)
        .map((row) => ({ id: row.dependsOnTaskId, title: row.title, status: row.status })),
      subtasks: subtasks.get(task.id) ?? null,
      nextStatuses: writable ? allowedStatuses(task.status) : [],
    })),
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

function canAnyWrite(ctx: ServiceContext): boolean {
  return can(ctx.actor, "tasks:update") || can(ctx.actor, "tasks:update_assigned");
}

function allowedStatuses(from: TaskStatus): TaskStatus[] {
  return TASK_STATUSES.filter((status) => canTaskTransition(from, status));
}

export interface TaskHistoryEntry {
  id: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  occurredAt: Date;
}

function describeAudit(
  row: taskRepository.AuditRow,
  names: ReadonlyMap<string, string>,
): TaskHistoryEntry {
  const label = AUDIT_ACTIONS[row.action as AuditAction] ?? row.action;
  const { from, to, title } = row.metadata;
  let detail: string | null = null;
  if (row.action === "task.status_changed") {
    const labels: Record<string, string> = TASK_STATUS_LABELS;
    detail = `${labels[String(from)] ?? from} → ${labels[String(to)] ?? to}`;
  } else if (row.action === "task.assigned") {
    const nameOf = (value: unknown) =>
      typeof value === "string" ? (names.get(value) ?? "Personne retirée") : "Personne";
    detail = `${nameOf(from)} → ${nameOf(to)}`;
  } else if (typeof title === "string") {
    detail = title;
  }
  return {
    id: row.id,
    title: label,
    detail,
    actorName: row.actorName,
    occurredAt: row.occurredAt,
  };
}

export interface TaskDetail {
  id: string;
  number: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Task["priority"];
  dueOn: string | null;
  estimatedMinutes: number | null;
  phaseId: string | null;
  completedAt: Date | null;
  projectId: string;
  projectNumber: string;
  projectLabel: string;
  companyId: string;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  parent: { id: string; title: string } | null;
  dependsOn: { id: string; title: string; status: TaskStatus; dueOn: string | null }[];
  subtasks: taskRepository.TaskRow[];
  comments: CommentView[];
  history: TaskHistoryEntry[];
  nextStatuses: TaskStatus[];
  capabilities: {
    editDescription: boolean;
    editPlanning: boolean;
    addSubtask: boolean;
    comment: boolean;
    archive: boolean;
  };
  /** Listes de choix, vides pour qui ne peut pas s'en servir. */
  options: {
    members: MemberOption[];
    phases: { id: string; name: string }[];
    tasks: { id: string; number: string; title: string; status: TaskStatus }[];
    documents: { id: string; title: string }[];
    /** Qui peut être mentionné ici : une mention ne vise que qui peut lire la tâche. */
    mentionable: MentionOption[];
  };
}

export async function getTaskDetail(ctx: ServiceContext, taskId: string): Promise<TaskDetail> {
  const task = await requireReadableTask(ctx, taskId);
  const scope = await resolveProjectScope(ctx);
  const detail = await taskRepository.findTaskDetail(ctx.db, taskId);
  if (!detail) throw new NotFoundError("Tâche introuvable.");

  const editable =
    detail.projectStatus !== "closed" &&
    (await repository.findProject(ctx.db, task.projectId))?.archivedAt === null;
  const editPlanning = editable && can(ctx.actor, "tasks:update");
  const canComment = editable && canAnyWrite(ctx);

  const [dependsOn, subtasks, comments, audit, members, phases, tasks, documents, candidates] =
    await Promise.all([
      taskRepository.dependenciesOf(ctx.db, [taskId]),
      taskRepository.listSubtasks(ctx.db, {
        parentTaskId: taskId,
        assigneeMemberId: scope.assigneeMemberId,
      }),
      listComments(ctx, { entityType: "task", entityId: taskId }),
      taskRepository.listEntityAudit(ctx.db, { entityType: "task", entityId: taskId, limit: 50 }),
      listAssignableMembers(ctx.db),
      editPlanning ? production.listPhases(ctx.db, task.projectId) : Promise.resolve([]),
      editPlanning
        ? taskRepository.listTaskOptions(ctx.db, {
            projectId: task.projectId,
            excludeTaskId: taskId,
          })
        : Promise.resolve([]),
      // Un prestataire lit les documents de ses projets, jamais les pièces commerciales. Sans
      // `finance:read`, le périmètre des documents masque aussi les factures des autres.
      scope.assignedOnly || !can(ctx.actor, "finance:read")
        ? listDocumentsFor(ctx, { projectId: task.projectId, limit: 200 })
        : repository.listDocumentsOfProject(ctx.db, task.projectId),
      canComment ? listMentionCandidates(ctx) : Promise.resolve([]),
    ]);

  const unreachable = new Set(
    members
      .filter((member) => member.kind === "contractor" && member.id !== task.assigneeMemberId)
      .map((member) => member.userId),
  );

  const names = new Map(members.map((member) => [member.id, member.fullName]));
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueOn: task.dueOn,
    estimatedMinutes: task.estimatedMinutes,
    phaseId: task.phaseId,
    completedAt: task.completedAt,
    projectId: task.projectId,
    projectNumber: detail.projectNumber,
    projectLabel: projectTitle(detail.projectName, detail.companyName),
    companyId: detail.companyId,
    assigneeMemberId: task.assigneeMemberId,
    assigneeName: detail.assigneeName,
    parent:
      task.parentTaskId && detail.parentTitle
        ? { id: task.parentTaskId, title: detail.parentTitle }
        : null,
    dependsOn: dependsOn.map((row) => ({
      id: row.dependsOnTaskId,
      title: row.title,
      status: row.status,
      dueOn: row.dueOn,
    })),
    subtasks,
    comments,
    history: audit.map((row) => describeAudit(row, names)),
    nextStatuses: editable && canAnyWrite(ctx) ? allowedStatuses(task.status) : [],
    capabilities: {
      editDescription: editable && canAnyWrite(ctx),
      editPlanning,
      addSubtask: editable && can(ctx.actor, "tasks:create") && !task.parentTaskId,
      comment: canComment,
      archive: editPlanning,
    },
    options: {
      members: editPlanning || canComment ? members : [],
      phases: phases.map((phase) => ({ id: phase.id, name: phase.name })),
      tasks,
      documents: documents.map((document) => ({ id: document.id, title: document.title })),
      mentionable: candidates.filter((candidate) => !unreachable.has(candidate.id)),
    },
  };
}

/** Tâches en retard, pour la détection quotidienne des automatisations (`task.overdue`). */
export async function listOverdueTasks(
  db: Database,
  now: Date = new Date(),
): Promise<taskRepository.OverdueTaskRow[]> {
  return taskRepository.listOverdueTasks(db, parisDay(now));
}

// --- Calendrier --------------------------------------------------------------------------------

export interface CalendarEntry {
  id: string;
  kind: "task" | "phase" | "go_live";
  day: string;
  title: string;
  projectId: string;
  projectLabel: string;
  href: string;
  /** Terminé : affiché en retrait. */
  done: boolean;
}

/** Jalons, échéances de tâches et mises en ligne d'une période, dans le périmètre de l'acteur. */
export async function listCalendarEntries(
  ctx: ServiceContext,
  input: { from: string; to: string },
): Promise<CalendarEntry[]> {
  const scope = await resolveProjectScope(ctx);
  const range = parseInput(calendarRangeSchema, input);
  const [phases, tasks, projects] = await Promise.all([
    production.listPhasesDueBetween(ctx.db, {
      from: range.from,
      to: range.to,
      projectIds: scope.projectIds,
      limit: 500,
    }),
    taskRepository.listTasksDueBetween(ctx.db, {
      from: range.from,
      to: range.to,
      projectIds: scope.projectIds,
      assigneeMemberId: scope.assigneeMemberId,
      limit: 500,
    }),
    repository.listProjectsDueBetween(ctx.db, {
      from: range.from,
      to: range.to,
      projectIds: scope.projectIds,
      limit: 200,
    }),
  ]);
  const entries: CalendarEntry[] = [
    ...projects.map((project) => ({
      id: `project-${project.id}`,
      kind: "go_live" as const,
      day: project.dueOn,
      title: "Mise en ligne prévue",
      projectId: project.id,
      projectLabel: projectTitle(project.name, project.companyName),
      href: `/projets/${project.id}`,
      done: project.status === "delivered" || project.status === "closed",
    })),
    ...phases.map((phase) => ({
      id: `phase-${phase.id}`,
      kind: "phase" as const,
      day: phase.dueOn,
      title: phase.name,
      projectId: phase.projectId,
      projectLabel: projectTitle(phase.projectName, phase.companyName),
      href: `/projets/${phase.projectId}`,
      done: phase.status === "done",
    })),
    ...tasks.map((task) => ({
      id: `task-${task.id}`,
      kind: "task" as const,
      day: task.dueOn,
      title: task.title,
      projectId: task.projectId,
      projectLabel: projectTitle(task.projectName, task.companyName),
      href: `/projets/${task.projectId}?tache=${task.id}`,
      done: task.status === "done",
    })),
  ];
  return entries.sort((a, b) => a.day.localeCompare(b.day));
}
