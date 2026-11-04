import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocusealGateway } from "@/integrations/docuseal";
import { convertChangeRequestToQuote } from "@/modules/projects/change-request.conversion";
import {
  acceptChangeRequest,
  changePhaseStatus,
  createChangeRequest,
  createDeliverable,
  createPhase,
  markRequirementReceived,
  createRequirement,
  raiseBlocker,
  recordDeliverableReview,
  refuseChangeRequest,
  resolveBlocker,
  startDeliverableVersion,
  submitDeliverable,
  toggleHandoverItem,
  addHandoverItem,
  updateDeliverable,
} from "@/modules/projects/production.service";
import {
  archiveProject,
  changeProjectStatus,
  createProject as createProjectService,
  createProjectFromQuote,
  getProjectDetail,
  goLiveProject,
  listProjects,
  listProjectsForCompany,
  restoreProject,
} from "@/modules/projects/project.service";
import {
  addTaskComment,
  archiveTask,
  changeTaskStatus,
  getTaskDetail,
  listCalendarEntries,
  listTasks,
  updateTask,
} from "@/modules/projects/task.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createDocument,
  createMemberContext,
  createPortalTestContext,
  createProject,
  createQuote,
  createTask,
  createTicket,
} from "../../helpers/factories";

const deps = { docuseal: { isConfigured: false } as unknown as DocusealGateway };

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;

beforeAll(async () => {
  const test = await createTestDatabase();
  db = test.db;
  close = test.close;
  admin = await createMemberContext(db, "admin");
});

afterAll(async () => {
  await close();
});

async function auditCount(action: string, entityId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.entityId, entityId)));
  return rows.length;
}

async function eventCount(type: string, entityId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.domainEvents.id })
    .from(schema.domainEvents)
    .where(and(eq(schema.domainEvents.type, type), eq(schema.domainEvents.entityId, entityId)));
  return rows.length;
}

/** Deux soumissions simultanées : la seconde ne doit rien produire de plus que la première. */
async function twice<T>(run: () => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled([run(), run()]);
}

describe("périmètre du prestataire", () => {
  it("une fiche désactivée n'ouvre plus ses tâches, ni en lecture ni en écriture", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db, { status: "active" });
    const task = await createTask(db, {
      projectId: project.id,
      assigneeMemberId: contractor.member.id,
    });
    await expect(getTaskDetail(contractor, task.id)).resolves.toMatchObject({ id: task.id });

    await db
      .update(schema.teamMembers)
      .set({ status: "inactive" })
      .where(eq(schema.teamMembers.id, contractor.member.id));

    await expect(getTaskDetail(contractor, task.id)).rejects.toThrow(NotFoundError);
    await expect(
      changeTaskStatus(contractor, { taskId: task.id, status: "in_progress" }),
    ).rejects.toThrow(NotFoundError);
    await expect(updateTask(contractor, { taskId: task.id, description: "x" })).rejects.toThrow(
      NotFoundError,
    );
    await expect(addTaskComment(contractor, { taskId: task.id, body: "x" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("un projet archivé disparaît pour le prestataire, liste comprise", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db, { status: "active" });
    const task = await createTask(db, {
      projectId: project.id,
      assigneeMemberId: contractor.member.id,
    });
    await archiveProject(admin, project.id);

    await expect(getProjectDetail(contractor, project.id)).rejects.toThrow(NotFoundError);
    await expect(listTasks(contractor, { projectId: project.id })).rejects.toThrow(NotFoundError);
    await expect(getTaskDetail(contractor, task.id)).rejects.toThrow(NotFoundError);
    const { items } = await listProjects(contractor, { view: "archived" });
    expect(items.map((item) => item.id)).not.toContain(project.id);

    // L'équipe garde l'accès : c'est elle qui restaure.
    await expect(getProjectDetail(admin, project.id)).resolves.toMatchObject({ archived: true });
  });

  it("ne voit jamais le titre d'un document commercial du projet", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id, status: "active" });
    const task = await createTask(db, {
      projectId: project.id,
      assigneeMemberId: contractor.member.id,
    });
    await createDocument(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Facture acompte confidentielle",
      kind: "invoice",
    });
    await createDocument(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Maquette accueil",
      kind: "mockup",
    });

    const detail = await getTaskDetail(contractor, task.id);
    expect(detail.options.documents.map((document) => document.title)).toEqual([
      "Maquette accueil",
    ]);
    const fiche = await getProjectDetail(contractor, project.id);
    expect(fiche.documents.map((document) => document.title)).toEqual(["Maquette accueil"]);

    const team = await getTaskDetail(admin, task.id);
    expect(team.options.documents).toHaveLength(2);
  });

  it("ne propose de mentionner que qui peut lire la tâche", async () => {
    const assignee = await createMemberContext(db, "contractor");
    const other = await createMemberContext(db, "contractor");
    const member = await createMemberContext(db, "member");
    const task = await createTask(db, {
      projectId: (await createProject(db, { status: "active" })).id,
      assigneeMemberId: assignee.member.id,
    });

    const detail = await getTaskDetail(admin, task.id);
    const ids = detail.options.mentionable.map((candidate) => candidate.id);
    expect(ids).toContain(assignee.actor.userId);
    expect(ids).toContain(member.actor.userId);
    expect(ids).not.toContain(other.actor.userId);
  });
});

describe("un projet clôturé ou archivé ne se modifie plus", () => {
  it("ne propose aucune modification sur un projet clôturé", async () => {
    const project = await createProject(db, { status: "closed" });
    const detail = await getProjectDetail(admin, project.id);
    expect(detail.capabilities.edit).toBe(false);
    expect(detail.capabilities.addTask).toBe(false);
    expect(detail.capabilities.convertToQuote).toBe(false);
  });

  it.each(["closed", "archived"] as const)(
    "refuse un commentaire sur un projet %s",
    async (state) => {
      const project = await createProject(db, {
        status: state === "closed" ? "closed" : "active",
        archivedAt: state === "archived" ? new Date() : null,
      });
      const task = await createTask(db, { projectId: project.id });
      await expect(addTaskComment(admin, { taskId: task.id, body: "Trop tard" })).rejects.toThrow(
        ConflictError,
      );
      const detail = await getTaskDetail(admin, task.id);
      expect(detail.capabilities.comment).toBe(false);
    },
  );

  it("le portail ne valide plus un livrable d'un projet clôturé", async () => {
    const portal = await createPortalTestContext(db);
    const project = await createProject(db, { companyId: portal.companyId, status: "active" });
    const deliverable = await createDeliverable(admin, {
      projectId: project.id,
      title: "Maquette",
      requiresClientValidation: "on",
    });
    await submitDeliverable(admin, { deliverableId: deliverable.id });
    await db
      .update(schema.projects)
      .set({ status: "closed" })
      .where(eq(schema.projects.id, project.id));
    await expect(
      recordDeliverableReview(portal, { deliverableId: deliverable.id, decision: "validated" }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("répétitions simultanées", () => {
  it("accepter deux fois une demande ne double ni la tâche ni le budget", async () => {
    const project = await createProject(db, {
      status: "active",
      budgetCents: 100_000,
      estimatedMinutes: 1000,
    });
    const request = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Page presse",
      amountCents: 50_000,
      estimatedMinutes: 500,
    });

    await twice(() => acceptChangeRequest(admin, { changeRequestId: request.id }));

    const [fresh] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(fresh).toMatchObject({ budgetCents: 150_000, estimatedMinutes: 1500 });
    const created = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, project.id));
    expect(created).toHaveLength(1);
    expect(await auditCount("change_request.accepted", request.id)).toBe(1);
  });

  it("accepter et refuser en même temps : une seule décision reste", async () => {
    const project = await createProject(db, { status: "active", budgetCents: 100_000 });
    const request = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Blog",
      amountCents: 10_000,
    });
    const results = await Promise.allSettled([
      acceptChangeRequest(admin, { changeRequestId: request.id }),
      refuseChangeRequest(admin, { changeRequestId: request.id }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accepted = await auditCount("change_request.accepted", request.id);
    const refused = await auditCount("change_request.refused", request.id);
    expect(accepted + refused).toBe(1);
  });

  it("une revue envoyée deux fois n'écrit qu'une décision et une seule demande", async () => {
    const project = await createProject(db, { status: "active" });
    const deliverable = await createDeliverable(admin, {
      projectId: project.id,
      title: "Maquette",
      requiresClientValidation: "on",
      feedbackRoundsIncluded: 1,
    });
    await submitDeliverable(admin, { deliverableId: deliverable.id });
    await recordDeliverableReview(admin, {
      deliverableId: deliverable.id,
      decision: "changes_requested",
    });
    await submitDeliverable(admin, { deliverableId: deliverable.id });

    await twice(() =>
      recordDeliverableReview(admin, {
        deliverableId: deliverable.id,
        decision: "changes_requested",
      }),
    );

    const reviews = await db
      .select()
      .from(schema.deliverableReviews)
      .where(eq(schema.deliverableReviews.deliverableId, deliverable.id));
    expect(reviews).toHaveLength(2);
    const requests = await db
      .select()
      .from(schema.changeRequests)
      .where(eq(schema.changeRequests.projectId, project.id));
    expect(requests).toHaveLength(1);
  });

  it("soumettre et repartir deux fois n'avancent la version qu'une fois", async () => {
    const project = await createProject(db, { status: "active" });
    const deliverable = await createDeliverable(admin, { projectId: project.id, title: "Logo" });
    await twice(() => submitDeliverable(admin, { deliverableId: deliverable.id }));
    expect(await auditCount("deliverable.submitted", deliverable.id)).toBe(1);

    await recordDeliverableReview(admin, { deliverableId: deliverable.id, decision: "validated" });
    await twice(() => startDeliverableVersion(admin, { deliverableId: deliverable.id }));
    const [row] = await db
      .select()
      .from(schema.deliverables)
      .where(eq(schema.deliverables.id, deliverable.id));
    expect(row).toMatchObject({ status: "draft", version: 2 });
    expect(await auditCount("deliverable.updated", deliverable.id)).toBe(1);
  });

  it("une mise en ligne envoyée deux fois n'émet qu'une transition", async () => {
    const project = await createProject(db, { status: "in_validation" });
    await twice(() => goLiveProject(admin, { projectId: project.id }));
    expect(await eventCount("project.status_changed", project.id)).toBe(1);
    expect(await auditCount("project.delivered", project.id)).toBe(1);
  });

  it("un changement de statut envoyé deux fois ne compte qu'une fois", async () => {
    const project = await createProject(db, { status: "active" });
    await twice(() => changeProjectStatus(admin, { projectId: project.id, status: "blocked" }));
    expect(await eventCount("project.status_changed", project.id)).toBe(1);
    expect(await auditCount("project.status_changed", project.id)).toBe(1);
  });

  it("la clôture relit la passation au moment d'écrire", async () => {
    const project = await createProject(db, { status: "delivered" });
    const item = await addHandoverItem(admin, { projectId: project.id, label: "Accès remis" });
    await toggleHandoverItem(admin, { itemId: item.id, done: true });
    const results = await Promise.allSettled([
      toggleHandoverItem(admin, { itemId: item.id, done: false }),
      changeProjectStatus(admin, { projectId: project.id, status: "closed" }),
    ]);
    const [fresh] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    const [row] = await db
      .select()
      .from(schema.handoverChecklistItems)
      .where(eq(schema.handoverChecklistItems.id, item.id));
    // Jamais un projet clôturé avec un point rouvert.
    expect(fresh?.status === "closed" && row?.doneAt === null).toBe(false);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  });

  it("statuts de tâche et de jalon, blocage, contenu, passation : une seule écriture", async () => {
    const project = await createProject(db, { status: "active" });
    const task = await createTask(db, { projectId: project.id });
    await twice(() => changeTaskStatus(admin, { taskId: task.id, status: "in_progress" }));
    expect(await auditCount("task.status_changed", task.id)).toBe(1);

    const phase = await createPhase(admin, { projectId: project.id, name: "Design" });
    await twice(() => changePhaseStatus(admin, { phaseId: phase.id, status: "in_progress" }));
    expect(await auditCount("project_phase.updated", phase.id)).toBe(1);

    const blocker = await raiseBlocker(admin, { projectId: project.id, title: "Photos" });
    await twice(() => resolveBlocker(admin, { blockerId: blocker.id }));
    expect(await auditCount("project_blocker.resolved", blocker.id)).toBe(1);

    const requirement = await createRequirement(admin, { projectId: project.id, label: "Textes" });
    await twice(() => markRequirementReceived(admin, { requirementId: requirement.id }));
    expect(await auditCount("client_requirement.received", requirement.id)).toBe(1);

    const item = await addHandoverItem(admin, { projectId: project.id, label: "Accès" });
    await twice(() => toggleHandoverItem(admin, { itemId: item.id, done: true }));
    expect(await auditCount("handover_item.done", item.id)).toBe(1);

    await twice(() => archiveTask(admin, task.id));
    expect(await auditCount("task.archived", task.id)).toBe(1);
  });
});

describe("commentaires, sur le vrai service partagé", () => {
  it("un renvoi avec le même identifiant ne crée qu'un commentaire", async () => {
    const project = await createProject(db, { status: "active" });
    const task = await createTask(db, { projectId: project.id });
    const input = {
      taskId: task.id,
      body: "Relu",
      clientRequestId: "6f1f2c52-5f5e-4d2a-9f7b-3f6c1a2b4d11",
    };
    await addTaskComment(admin, input);
    await addTaskComment(admin, input);
    const detail = await getTaskDetail(admin, task.id);
    expect(detail.comments).toHaveLength(1);
  });

  it("une réponse se rattache à son fil, jamais à celui d'une autre tâche", async () => {
    const project = await createProject(db, { status: "active" });
    const task = await createTask(db, { projectId: project.id });
    const other = await createTask(db, { projectId: project.id });
    const root = await addTaskComment(admin, { taskId: task.id, body: "Question" });
    const reply = await addTaskComment(admin, {
      taskId: task.id,
      body: "Réponse",
      parentId: root.id,
    });
    expect(reply.parentId).toBe(root.id);
    await expect(
      addTaskComment(admin, { taskId: other.id, body: "Détour", parentId: root.id }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("fiche projet", () => {
  it("raconte le projet à l'équipe, pas au prestataire", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const company = await createCompany(db);
    const project = await createProjectService(admin, { companyId: company.id, name: "Refonte" });
    await createTask(db, { projectId: project.id, assigneeMemberId: contractor.member.id });
    await changeProjectStatus(admin, { projectId: project.id, status: "active" });

    const fiche = await getProjectDetail(admin, project.id);
    expect(fiche.history.map((entry) => entry.detail)).toContain("Préparation → En cours");
    const scoped = await getProjectDetail(contractor, project.id);
    expect(scoped.history).toEqual([]);
    expect(scoped.budgetCents).toBeNull();
    expect(scoped.planned).toBeNull();
  });

  it("sans modèle, un projet reçoit une passation qui retient la clôture", async () => {
    const company = await createCompany(db);
    const project = await createProjectService(admin, {
      companyId: company.id,
      name: "Sans modèle",
    });
    const fiche = await getProjectDetail(admin, project.id);
    expect(fiche.handover.length).toBeGreaterThan(0);

    await db
      .update(schema.projects)
      .set({ status: "delivered" })
      .where(eq(schema.projects.id, project.id));
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "closed" }),
    ).rejects.toThrow(ConflictError);
  });

  it("le calendrier refuse une période mal formée", async () => {
    await expect(listCalendarEntries(admin, { from: "9999-99-99", to: "x" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("un ticket converti deux fois à la fois ne crée qu'une demande", async () => {
    const company = await createCompany(db);
    const ticket = await createTicket(db, { companyId: company.id });
    await twice(() =>
      createChangeRequest(admin, {
        companyId: company.id,
        ticketId: ticket.id,
        title: "Hors forfait",
      }),
    );
    const rows = await db
      .select()
      .from(schema.changeRequests)
      .where(eq(schema.changeRequests.ticketId, ticket.id));
    expect(rows).toHaveLength(1);
  });
});

describe("transformation en devis", () => {
  it("deux envois simultanés ne créent qu'un devis", async () => {
    const project = await createProject(db, { status: "active" });
    const request = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Double clic",
      amountCents: 10_000,
    });
    const before = (await db.select().from(schema.quotes)).length;
    const results = await twice(() =>
      convertChangeRequestToQuote(admin, { changeRequestId: request.id }, deps),
    );
    const after = (await db.select().from(schema.quotes)).length;
    expect(after - before).toBe(1);
    const ids = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.quoteId] : [],
    );
    expect(new Set(ids).size).toBe(1);
  });

  it("si le chiffrage échoue, rien ne reste : ni devis, ni lien, ni numéro consommé", async () => {
    const project = await createProject(db, { status: "active" });
    const request = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Chiffrage impossible",
      // Au-delà de ce qu'une ligne de devis accepte.
      amountCents: 2_000_000_000,
      estimatedMinutes: 2_000_000_000,
    });
    const before = (await db.select().from(schema.quotes)).length;
    await expect(
      convertChangeRequestToQuote(admin, { changeRequestId: request.id }, deps),
    ).rejects.toThrow(ValidationError);
    expect((await db.select().from(schema.quotes)).length).toBe(before);
    const [row] = await db
      .select()
      .from(schema.changeRequests)
      .where(eq(schema.changeRequests.id, request.id));
    expect(row).toMatchObject({ status: "open", quoteId: null });
  });
});

describe("règles", () => {
  it("un devis non accepté ne crée pas de projet", async () => {
    const company = await createCompany(db);
    const { quote, version } = await createQuote(db, { companyId: company.id, status: "draft" });
    await expect(
      db.transaction((tx) =>
        createProjectFromQuote(admin, tx, {
          quoteId: quote.id,
          opportunityId: null,
          companyId: company.id,
          versionId: version.id,
        }),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("une validation demandée au client ne se retire plus une fois soumise", async () => {
    const project = await createProject(db, { status: "in_validation" });
    const deliverable = await createDeliverable(admin, {
      projectId: project.id,
      title: "Maquette",
      requiresClientValidation: "on",
    });
    await submitDeliverable(admin, { deliverableId: deliverable.id });
    await expect(
      updateDeliverable(admin, {
        deliverableId: deliverable.id,
        title: "Maquette",
        requiresClientValidation: "",
      }),
    ).rejects.toThrow(ConflictError);
    await expect(goLiveProject(admin, { projectId: project.id })).rejects.toThrow(ConflictError);
  });

  it("une demande sur un client inconnu est refusée proprement", async () => {
    await expect(
      createChangeRequest(admin, {
        companyId: "00000000-0000-4000-8000-000000000000",
        title: "Fantôme",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("le droit passe avant la validation de l'entrée", async () => {
    const viewer = await createMemberContext(db, "viewer");
    await expect(createPhase(viewer, { projectId: "pas-un-uuid", name: "" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(raiseBlocker(viewer, { projectId: "pas-un-uuid", title: "" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(acceptChangeRequest(viewer, { changeRequestId: "pas-un-uuid" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it.each([
    ["archiveProject", () => archiveProject(admin, "pas-un-uuid")],
    ["restoreProject", () => restoreProject(admin, "pas-un-uuid")],
    ["archiveTask", () => archiveTask(admin, "pas-un-uuid")],
    ["listProjectsForCompany", () => listProjectsForCompany(admin, "pas-un-uuid")],
  ])("%s refuse un identifiant mal formé sans erreur de base", async (_name, run) => {
    await expect(run()).rejects.toThrow(ValidationError);
  });
});
