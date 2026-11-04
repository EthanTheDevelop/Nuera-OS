import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTaskComment,
  addTaskDependency,
  archiveTask,
  changeTaskStatus,
  createTask,
  getTaskDetail,
  listCalendarEntries,
  listOverdueTasks,
  listTasks,
  removeTaskDependency,
  updateTask,
} from "@/modules/projects/task.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createMemberContext,
  createPhase,
  createProject,
  createTask as createTaskRow,
  createTeamMember,
} from "../../helpers/factories";

/** Le service de commentaires appartient au lot Messages : ici, seul le contrôle d'accès compte. */
const comments = vi.hoisted(() => ({ add: vi.fn(), list: vi.fn() }));
vi.mock("@/modules/messaging/comment.service", () => ({
  addComment: comments.add,
  listComments: comments.list,
  listMentionCandidates: async () => [],
}));

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let viewer: ServiceContext;
let contractor: ServiceContext & { member: schema.TeamMember };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createMemberContext(db, "admin");
  viewer = await createTestContext(db, "viewer");
  contractor = await createMemberContext(db, "contractor");
});
afterAll(async () => close());
beforeEach(() => {
  comments.add.mockReset();
  comments.list.mockReset();
  comments.list.mockResolvedValue([]);
  comments.add.mockImplementation(async (_ctx, input) => ({ id: "c", ...input }));
});

describe("création", () => {
  it("numérote, place à la suite et journalise", async () => {
    const project = await createProject(db, { status: "active" });
    const first = await createTask(admin, { projectId: project.id, title: "Première" });
    const second = await createTask(admin, { projectId: project.id, title: "Seconde" });
    expect(first.number).toMatch(/^TA-\d{4}-\d{3}$/);
    expect(second.position).toBe(first.position + 1);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, first.id));
    expect(audit.map((row) => row.action)).toEqual(["task.created"]);
  });

  it("refuse un jalon, un parent ou un responsable hors du projet", async () => {
    const project = await createProject(db);
    const foreignPhase = await createPhase(db);
    const foreignTask = await createTaskRow(db);
    await expect(
      createTask(admin, { projectId: project.id, title: "x", phaseId: foreignPhase.id }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createTask(admin, { projectId: project.id, title: "x", parentTaskId: foreignTask.id }),
    ).rejects.toThrow(ValidationError);
    const gone = await createTeamMember(db, { status: "inactive" });
    await expect(
      createTask(admin, { projectId: project.id, title: "x", assigneeMemberId: gone.id }),
    ).rejects.toThrow(ValidationError);
  });

  it("une sous-tâche hérite du jalon, et n'a pas de sous-tâches", async () => {
    const project = await createProject(db);
    const phase = await createPhase(db, { projectId: project.id });
    const parent = await createTask(admin, {
      projectId: project.id,
      title: "Parente",
      phaseId: phase.id,
    });
    const child = await createTask(admin, {
      projectId: project.id,
      title: "Enfant",
      parentTaskId: parent.id,
    });
    expect(child.phaseId).toBe(phase.id);
    await expect(
      createTask(admin, { projectId: project.id, title: "Petite-fille", parentTaskId: child.id }),
    ).rejects.toThrow(ConflictError);
  });

  it("refuse la création sur un projet clôturé, et aux rôles sans droit", async () => {
    const closed = await createProject(db, { status: "closed" });
    await expect(createTask(admin, { projectId: closed.id, title: "x" })).rejects.toThrow(
      ConflictError,
    );
    const project = await createProject(db);
    await expect(createTask(viewer, { projectId: project.id, title: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(createTask(contractor, { projectId: project.id, title: "x" })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("statut", () => {
  it("suit la machine à états", async () => {
    const task = await createTaskRow(db);
    await expect(
      changeTaskStatus(admin, { taskId: task.id, status: "todo" }),
    ).resolves.toMatchObject({ status: "todo" });
    await changeTaskStatus(admin, { taskId: task.id, status: "blocked" });
    await expect(changeTaskStatus(admin, { taskId: task.id, status: "done" })).rejects.toThrow(
      ConflictError,
    );
    await changeTaskStatus(admin, { taskId: task.id, status: "in_progress" });
    const done = await changeTaskStatus(admin, { taskId: task.id, status: "done" });
    expect(done.completedAt).toBeInstanceOf(Date);
    await expect(changeTaskStatus(admin, { taskId: task.id, status: "todo" })).rejects.toThrow(
      ConflictError,
    );
    const reopened = await changeTaskStatus(admin, { taskId: task.id, status: "in_progress" });
    expect(reopened.completedAt).toBeNull();
  });

  it("ne termine pas une tâche dont une dépendance ou une sous-tâche reste ouverte", async () => {
    const project = await createProject(db);
    const prerequisite = await createTaskRow(db, { projectId: project.id, title: "Photos" });
    const task = await createTaskRow(db, { projectId: project.id });
    await addTaskDependency(admin, { taskId: task.id, dependsOnTaskId: prerequisite.id });
    await expect(changeTaskStatus(admin, { taskId: task.id, status: "done" })).rejects.toThrow(
      /Photos/,
    );
    await changeTaskStatus(admin, { taskId: prerequisite.id, status: "done" });
    await createTaskRow(db, { projectId: project.id, parentTaskId: task.id, title: "Mobile" });
    await expect(changeTaskStatus(admin, { taskId: task.id, status: "done" })).rejects.toThrow(
      /Mobile/,
    );
  });

  it("répéter le même statut ne journalise rien de plus", async () => {
    const task = await createTaskRow(db);
    await changeTaskStatus(admin, { taskId: task.id, status: "in_progress" });
    await changeTaskStatus(admin, { taskId: task.id, status: "in_progress" });
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, task.id));
    expect(audit).toHaveLength(1);
  });
});

describe("dépendances", () => {
  it("refuse boucle directe, indirecte et auto-dépendance", async () => {
    const project = await createProject(db);
    const a = await createTaskRow(db, { projectId: project.id });
    const b = await createTaskRow(db, { projectId: project.id });
    const c = await createTaskRow(db, { projectId: project.id });
    await addTaskDependency(admin, { taskId: b.id, dependsOnTaskId: a.id });
    await addTaskDependency(admin, { taskId: c.id, dependsOnTaskId: b.id });
    await expect(addTaskDependency(admin, { taskId: a.id, dependsOnTaskId: b.id })).rejects.toThrow(
      /boucle/,
    );
    await expect(addTaskDependency(admin, { taskId: a.id, dependsOnTaskId: c.id })).rejects.toThrow(
      /boucle/,
    );
    await expect(addTaskDependency(admin, { taskId: a.id, dependsOnTaskId: a.id })).rejects.toThrow(
      /boucle/,
    );
  });

  it("refuse une dépendance vers un autre projet", async () => {
    const a = await createTaskRow(db);
    const b = await createTaskRow(db);
    await expect(addTaskDependency(admin, { taskId: a.id, dependsOnTaskId: b.id })).rejects.toThrow(
      ConflictError,
    );
  });

  it("répéter ne crée ni doublon ni entrée de journal, et se retire", async () => {
    const project = await createProject(db);
    const a = await createTaskRow(db, { projectId: project.id });
    const b = await createTaskRow(db, { projectId: project.id });
    await addTaskDependency(admin, { taskId: b.id, dependsOnTaskId: a.id });
    await addTaskDependency(admin, { taskId: b.id, dependsOnTaskId: a.id });
    const rows = await db
      .select()
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, b.id));
    expect(rows).toHaveLength(1);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, b.id));
    expect(audit).toHaveLength(1);

    await removeTaskDependency(admin, { taskId: b.id, dependsOnTaskId: a.id });
    await removeTaskDependency(admin, { taskId: b.id, dependsOnTaskId: a.id });
    const after = await db
      .select()
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, b.id));
    expect(after).toHaveLength(0);
  });

  it("une boucle refusée n'écrit rien et laisse les droits d'un prestataire de côté", async () => {
    const project = await createProject(db);
    const mine = await createTaskRow(db, {
      projectId: project.id,
      assigneeMemberId: contractor.member.id,
    });
    const other = await createTaskRow(db, {
      projectId: project.id,
      assigneeMemberId: contractor.member.id,
    });
    await expect(
      addTaskDependency(contractor, { taskId: mine.id, dependsOnTaskId: other.id }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("périmètre du prestataire", () => {
  async function setup() {
    const worker = await createMemberContext(db, "contractor");
    const project = await createProject(db, { status: "active" });
    const mine = await createTaskRow(db, {
      projectId: project.id,
      assigneeMemberId: worker.member.id,
      title: "Ma tâche",
    });
    const notMine = await createTaskRow(db, { projectId: project.id, title: "Autre" });
    return { worker, project, mine, notMine };
  }

  it("ne liste et ne lit que ses tâches", async () => {
    const { worker, project, mine, notMine } = await setup();
    const { items, total } = await listTasks(worker, { projectId: project.id });
    expect(total).toBe(1);
    expect(items[0]?.id).toBe(mine.id);
    await expect(getTaskDetail(worker, notMine.id)).rejects.toThrow(NotFoundError);
    const detail = await getTaskDetail(worker, mine.id);
    expect(detail.capabilities).toMatchObject({
      editDescription: true,
      editPlanning: false,
      addSubtask: false,
    });
    expect(detail.options.tasks).toEqual([]);
  });

  it("voit ses sous-tâches à plat, même quand la parente ne lui est pas affectée", async () => {
    const { worker, project, notMine } = await setup();
    const sub = await createTaskRow(db, {
      projectId: project.id,
      parentTaskId: notMine.id,
      assigneeMemberId: worker.member.id,
    });
    const { items } = await listTasks(worker, { projectId: project.id });
    expect(items.map((task) => task.id)).toContain(sub.id);
  });

  it("met à jour le statut et la description de ses tâches seulement", async () => {
    const { worker, mine, notMine } = await setup();
    await expect(
      changeTaskStatus(worker, { taskId: mine.id, status: "in_progress" }),
    ).resolves.toMatchObject({ status: "in_progress" });
    await expect(
      updateTask(worker, { taskId: mine.id, description: "Avancement" }),
    ).resolves.toMatchObject({ description: "Avancement" });
    await expect(
      changeTaskStatus(worker, { taskId: notMine.id, status: "in_progress" }),
    ).rejects.toThrow(NotFoundError);
    await expect(updateTask(worker, { taskId: notMine.id, description: "x" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("ne réaffecte, ne replanifie ni n'archive", async () => {
    const { worker, mine } = await setup();
    const someone = await createTeamMember(db);
    await expect(
      updateTask(worker, { taskId: mine.id, assigneeMemberId: someone.id }),
    ).rejects.toThrow(ForbiddenError);
    await expect(updateTask(worker, { taskId: mine.id, dueOn: "2030-01-01" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(updateTask(worker, { taskId: mine.id, title: "Autre titre" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(archiveTask(worker, mine.id)).rejects.toThrow(ForbiddenError);
  });

  it("le calendrier ne montre que son périmètre", async () => {
    const { worker, project, mine, notMine } = await setup();
    await db.update(schema.tasks).set({ dueOn: "2031-02-10" }).where(eq(schema.tasks.id, mine.id));
    await db
      .update(schema.tasks)
      .set({ dueOn: "2031-02-11" })
      .where(eq(schema.tasks.id, notMine.id));
    const range = { from: "2031-02-01", to: "2031-02-28" };
    expect((await listCalendarEntries(worker, range)).map((entry) => entry.id)).toEqual([
      `task-${mine.id}`,
    ]);
    const all = await listCalendarEntries(admin, range);
    expect(all.map((entry) => entry.projectId)).toContain(project.id);
    expect(all).toHaveLength(2);
  });
});

describe("modification", () => {
  it("modifie les champs reçus, et seulement ceux-là", async () => {
    const task = await createTaskRow(db, { title: "Avant", description: "Garde-moi" });
    const updated = await updateTask(admin, { taskId: task.id, title: "Après" });
    expect(updated).toMatchObject({ title: "Après", description: "Garde-moi" });
    const cleared = await updateTask(admin, { taskId: task.id, description: "" });
    expect(cleared.description).toBeNull();
  });

  it("une réaffectation s'écrit à part au journal et se lit dans l'historique", async () => {
    const task = await createTaskRow(db);
    const someone = await createTeamMember(db, { fullName: "Hugo Lemoine" });
    await updateTask(admin, { taskId: task.id, assigneeMemberId: someone.id });
    await changeTaskStatus(admin, { taskId: task.id, status: "in_progress" });

    const detail = await getTaskDetail(admin, task.id);
    expect(detail.assigneeName).toBe("Hugo Lemoine");
    const titles = detail.history.map((entry) => entry.title);
    expect(titles).toContain("Tâche attribuée");
    expect(titles).toContain("Statut de la tâche modifié");
    const status = detail.history.find((entry) => entry.title === "Statut de la tâche modifié");
    expect(status?.detail).toBe("À faire → En cours");
    const assigned = detail.history.find((entry) => entry.title === "Tâche attribuée");
    expect(assigned?.detail).toBe("Personne → Hugo Lemoine");
  });

  it("archive avec ses sous-tâches : plus aucune lecture", async () => {
    const project = await createProject(db);
    const parent = await createTaskRow(db, { projectId: project.id });
    const child = await createTaskRow(db, { projectId: project.id, parentTaskId: parent.id });
    await archiveTask(admin, parent.id);
    await expect(getTaskDetail(admin, parent.id)).rejects.toThrow(NotFoundError);
    await expect(getTaskDetail(admin, child.id)).rejects.toThrow(NotFoundError);
    expect((await listTasks(admin, { projectId: project.id })).total).toBe(0);
  });

  it("refuse toute écriture sur un projet clôturé", async () => {
    const closed = await createProject(db, { status: "closed" });
    const task = await createTaskRow(db, { projectId: closed.id });
    await expect(updateTask(admin, { taskId: task.id, title: "Non" })).rejects.toThrow(
      ConflictError,
    );
    await expect(
      changeTaskStatus(admin, { taskId: task.id, status: "in_progress" }),
    ).rejects.toThrow(ConflictError);
    const detail = await getTaskDetail(admin, task.id);
    expect(detail.nextStatuses).toEqual([]);
    expect(detail.capabilities.editPlanning).toBe(false);
  });
});

describe("liste", () => {
  it("pagine les tâches de premier niveau, avec dépendances et compteur de sous-tâches", async () => {
    const project = await createProject(db);
    const prerequisite = await createTaskRow(db, {
      projectId: project.id,
      title: "Photos client",
      position: 1,
    });
    const task = await createTaskRow(db, {
      projectId: project.id,
      title: "Galerie",
      position: 2,
    });
    await addTaskDependency(admin, { taskId: task.id, dependsOnTaskId: prerequisite.id });
    await createTaskRow(db, {
      projectId: project.id,
      parentTaskId: task.id,
      status: "done",
      position: 3,
    });
    await createTaskRow(db, { projectId: project.id, parentTaskId: task.id, position: 4 });

    const page = await listTasks(admin, { projectId: project.id, pageSize: 1, page: 2 });
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({
      title: "Galerie",
      subtasks: { total: 2, done: 1 },
      dependsOn: [{ title: "Photos client" }],
    });
    expect(page.items[0]?.nextStatuses).toEqual(["in_progress", "blocked", "done"]);
  });

  it("une recherche ou un filtre retrouvent aussi les sous-tâches", async () => {
    const project = await createProject(db);
    const parent = await createTaskRow(db, { projectId: project.id, title: "Parente" });
    await createTaskRow(db, {
      projectId: project.id,
      parentTaskId: parent.id,
      title: "Aiguille",
      status: "blocked",
    });
    expect((await listTasks(admin, { projectId: project.id, search: "Aiguille" })).total).toBe(1);
    expect((await listTasks(admin, { projectId: project.id, status: "blocked" })).total).toBe(1);
  });

  it("n'offre aucune transition à un lecteur", async () => {
    const task = await createTaskRow(db);
    const { items } = await listTasks(viewer, { projectId: task.projectId });
    expect(items[0]?.nextStatuses).toEqual([]);
    await expect(changeTaskStatus(viewer, { taskId: task.id, status: "done" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("répond 404 hors périmètre", async () => {
    const worker = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    await expect(listTasks(worker, { projectId: project.id })).rejects.toThrow(NotFoundError);
  });
});

describe("retards", () => {
  it("liste les tâches ouvertes échues, sur les projets en production", async () => {
    const company = await createCompany(db);
    const someone = await createTeamMember(db);
    const project = await createProject(db, { companyId: company.id, status: "active" });
    const overdue = await createTaskRow(db, {
      projectId: project.id,
      dueOn: "2026-11-03",
      assigneeMemberId: someone.id,
    });
    await createTaskRow(db, { projectId: project.id, dueOn: "2026-11-04" });
    await createTaskRow(db, { projectId: project.id, dueOn: "2026-11-03", status: "done" });
    await createTaskRow(db, {
      projectId: project.id,
      dueOn: "2026-11-03",
      archivedAt: new Date(),
    });
    const delivered = await createProject(db, { status: "delivered" });
    await createTaskRow(db, { projectId: delivered.id, dueOn: "2026-11-03" });

    const rows = await listOverdueTasks(db, new Date("2026-11-04T09:00:00Z"));
    const mine = rows.filter((row) => row.projectId === project.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: overdue.id,
      companyId: company.id,
      dueOn: "2026-11-03",
      assigneeMemberId: someone.id,
    });
    expect(rows.some((row) => row.projectId === delivered.id)).toBe(false);
  });
});

describe("commentaires", () => {
  it("passe l'objet, le client et le lien au service partagé", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const task = await createTaskRow(db, { projectId: project.id });
    await addTaskComment(admin, { taskId: task.id, body: "Bonjour" });
    expect(comments.add.mock.calls[0]?.[1]).toMatchObject({
      entityType: "task",
      entityId: task.id,
      companyId: company.id,
      body: "Bonjour",
      href: `/projets/${project.id}?tache=${task.id}`,
    });
  });

  it("contrôle l'accès avant de commenter", async () => {
    const worker = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    const task = await createTaskRow(db, { projectId: project.id });
    await expect(addTaskComment(viewer, { taskId: task.id, body: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(addTaskComment(worker, { taskId: task.id, body: "x" })).rejects.toThrow(
      NotFoundError,
    );
    expect(comments.add).not.toHaveBeenCalled();
  });

  it("refuse un commentaire vide et un document d'un autre projet", async () => {
    const task = await createTaskRow(db);
    await expect(addTaskComment(admin, { taskId: task.id, body: "   " })).rejects.toThrow(
      ValidationError,
    );
    const [document] = await db.insert(schema.documents).values({ title: "Ailleurs" }).returning();
    await expect(
      addTaskComment(admin, { taskId: task.id, body: "x", documentId: document?.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("le détail de la tâche lit le fil par le service partagé", async () => {
    const task = await createTaskRow(db);
    comments.list.mockResolvedValue([{ id: "c1", body: "Vu", authorName: "Ethan" }]);
    const detail = await getTaskDetail(admin, task.id);
    expect(comments.list.mock.calls[0]?.[1]).toEqual({ entityType: "task", entityId: task.id });
    expect(detail.comments).toHaveLength(1);
  });
});
