import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptChangeRequest,
  addHandoverItem,
  changePhaseStatus,
  createChangeRequest,
  createDeliverable,
  createPhase,
  createRequirement,
  linkChangeRequestQuote,
  listChangeRequestsForCompany,
  markRequirementReceived,
  raiseBlocker,
  recordDeliverableReview,
  refuseChangeRequest,
  reopenRequirement,
  resolveBlocker,
  startDeliverableVersion,
  submitDeliverable,
  toggleHandoverItem,
  updateBlocker,
  updateChangeRequest,
  updateDeliverable,
  updatePhase,
  updateRequirement,
} from "@/modules/projects/production.service";
import { getProjectDetail } from "@/modules/projects/project.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createDocument,
  createMemberContext,
  createPhase as createPhaseRow,
  createPortalTestContext,
  createProject,
  createQuote,
  createTicket,
} from "../../helpers/factories";

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let viewer: ServiceContext;
let contractor: ServiceContext;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createMemberContext(db, "admin");
  viewer = await createTestContext(db, "viewer");
  contractor = await createMemberContext(db, "contractor");
});
afterAll(async () => close());

async function eventsOf(type: string, entityId: string) {
  return db
    .select()
    .from(schema.domainEvents)
    .where(and(eq(schema.domainEvents.type, type), eq(schema.domainEvents.entityId, entityId)));
}

describe("jalons", () => {
  it("suit la machine : terminer éclaire le suivant et l'étape vue du client", async () => {
    const project = await createProject(db, { status: "active" });
    const first = await createPhaseRow(db, { projectId: project.id, name: "Cadrage", position: 1 });
    const second = await createPhaseRow(db, { projectId: project.id, name: "Design", position: 2 });

    await expect(changePhaseStatus(admin, { phaseId: first.id, status: "done" })).rejects.toThrow(
      ConflictError,
    );
    await changePhaseStatus(admin, { phaseId: first.id, status: "in_progress" });
    await changePhaseStatus(admin, { phaseId: first.id, status: "done" });

    const detail = await getProjectDetail(admin, project.id);
    expect(detail.phases.map((phase) => phase.status)).toEqual(["done", "in_progress"]);
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(row?.clientStepLabel).toBe("Design");

    await changePhaseStatus(admin, { phaseId: first.id, status: "in_progress" });
    expect(second.id).toBeTruthy();
  });

  it("répéter ne journalise rien, et refuse hors droit ou hors projet ouvert", async () => {
    const project = await createProject(db, { status: "active" });
    const phase = await createPhaseRow(db, { projectId: project.id, status: "in_progress" });
    await changePhaseStatus(admin, { phaseId: phase.id, status: "in_progress" });
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, phase.id));
    expect(audit).toHaveLength(0);
    await expect(changePhaseStatus(viewer, { phaseId: phase.id, status: "done" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      changePhaseStatus(contractor, { phaseId: phase.id, status: "done" }),
    ).rejects.toThrow(ForbiddenError);

    const closed = await createProject(db, { status: "closed" });
    const frozen = await createPhaseRow(db, { projectId: closed.id, status: "in_progress" });
    await expect(changePhaseStatus(admin, { phaseId: frozen.id, status: "done" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("crée à la suite et modifie", async () => {
    const project = await createProject(db);
    const a = await createPhase(admin, { projectId: project.id, name: "A", clientVisible: "on" });
    const b = await createPhase(admin, { projectId: project.id, name: "B" });
    expect(b.position).toBe(a.position + 1);
    expect(a.clientVisible).toBe(true);
    expect(b.clientVisible).toBe(false);
    const updated = await updatePhase(admin, {
      phaseId: a.id,
      name: "A bis",
      dueOn: "2026-12-01",
      clientVisible: "on",
    });
    expect(updated).toMatchObject({ name: "A bis", dueOn: "2026-12-01" });
  });
});

describe("livrables et validation", () => {
  async function submitted(rounds = 2) {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id, status: "active" });
    const deliverable = await createDeliverable(admin, {
      projectId: project.id,
      title: "Maquette accueil",
      requiresClientValidation: "on",
      feedbackRoundsIncluded: rounds,
    });
    await submitDeliverable(admin, { deliverableId: deliverable.id });
    return { company, project, deliverable };
  }

  it("soumet une fois, émet une fois", async () => {
    const { deliverable } = await submitted();
    const again = await submitDeliverable(admin, { deliverableId: deliverable.id });
    expect(again.status).toBe("to_validate");
    expect(again.version).toBe(1);
    expect(await eventsOf("deliverable.submitted", deliverable.id)).toHaveLength(1);
  });

  it("la validation par le client conserve la décision, et répéter ne change rien", async () => {
    const { company, deliverable } = await submitted();
    const client = await createPortalTestContext(db, { company });
    const result = await recordDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "validated",
      comment: "Parfait",
    });
    expect(result.deliverable.status).toBe("validated");
    expect(result.review).toMatchObject({
      version: 1,
      decision: "validated",
      comment: "Parfait",
      reviewerUserId: client.actor.userId,
    });
    expect(await eventsOf("deliverable.validated", deliverable.id)).toHaveLength(1);

    const again = await recordDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "validated",
    });
    expect(again.review.id).toBe(result.review.id);
    const reviews = await db
      .select()
      .from(schema.deliverableReviews)
      .where(eq(schema.deliverableReviews.deliverableId, deliverable.id));
    expect(reviews).toHaveLength(1);
    await expect(
      recordDeliverableReview(client, {
        deliverableId: deliverable.id,
        decision: "changes_requested",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("un client ne touche jamais au livrable d'un autre : 404", async () => {
    const { deliverable } = await submitted();
    const stranger = await createPortalTestContext(db);
    await expect(
      recordDeliverableReview(stranger, { deliverableId: deliverable.id, decision: "validated" }),
    ).rejects.toThrow(NotFoundError);
    const reviews = await db
      .select()
      .from(schema.deliverableReviews)
      .where(eq(schema.deliverableReviews.deliverableId, deliverable.id));
    expect(reviews).toHaveLength(0);
  });

  it("un client ne valide pas un livrable interne", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const internal = await createDeliverable(admin, { projectId: project.id, title: "Recette" });
    await submitDeliverable(admin, { deliverableId: internal.id });
    const client = await createPortalTestContext(db, { company });
    await expect(
      recordDeliverableReview(client, { deliverableId: internal.id, decision: "validated" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("les retours créent la version suivante à la soumission", async () => {
    const { company, deliverable } = await submitted();
    const client = await createPortalTestContext(db, { company });
    await recordDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "changes_requested",
      comment: "Titre trop grand",
    });
    const second = await submitDeliverable(admin, { deliverableId: deliverable.id });
    expect(second).toMatchObject({ status: "to_validate", version: 2 });
    expect(await eventsOf("deliverable.submitted", deliverable.id)).toHaveLength(2);
    expect(await eventsOf("deliverable.changes_requested", deliverable.id)).toHaveLength(1);
  });

  it("au-delà des tours inclus, une demande de changement s'ouvre, une fois par tour", async () => {
    const { company, project, deliverable } = await submitted(1);
    const client = await createPortalTestContext(db, { company });
    const first = await recordDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "changes_requested",
    });
    expect(first.outOfScopeChangeRequest).toBeNull();

    await submitDeliverable(admin, { deliverableId: deliverable.id });
    const second = await recordDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "changes_requested",
    });
    expect(second.outOfScopeChangeRequest).toMatchObject({
      projectId: project.id,
      companyId: company.id,
      status: "open",
    });
    const repeated = await recordDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "changes_requested",
    });
    expect(repeated.outOfScopeChangeRequest).toBeNull();
    const detail = await getProjectDetail(admin, project.id);
    expect(detail.changeRequests).toHaveLength(1);
    expect(detail.deliverables[0]).toMatchObject({ feedbackRoundsUsed: 2 });
    expect(detail.deliverables[0]?.reviews).toHaveLength(2);
  });

  it("suit la machine : pas de validation d'un brouillon, nouvelle version après validation", async () => {
    const project = await createProject(db);
    const draft = await createDeliverable(admin, { projectId: project.id, title: "Brouillon" });
    await expect(
      recordDeliverableReview(admin, { deliverableId: draft.id, decision: "validated" }),
    ).rejects.toThrow(ConflictError);
    await expect(startDeliverableVersion(admin, { deliverableId: draft.id })).rejects.toThrow(
      ConflictError,
    );
    await submitDeliverable(admin, { deliverableId: draft.id });
    await recordDeliverableReview(admin, { deliverableId: draft.id, decision: "validated" });
    await expect(submitDeliverable(admin, { deliverableId: draft.id })).rejects.toThrow(
      ConflictError,
    );
    const next = await startDeliverableVersion(admin, { deliverableId: draft.id });
    expect(next).toMatchObject({ status: "draft", version: 2 });
  });

  it("le document vient du projet, et ne change plus une fois soumis", async () => {
    const project = await createProject(db);
    const { document } = await createDocument(db, {
      companyId: project.companyId,
      projectId: project.id,
    });
    const { document: foreign } = await createDocument(db);
    await expect(
      createDeliverable(admin, {
        projectId: project.id,
        title: "x",
        documentId: foreign.id,
      }),
    ).rejects.toThrow(ValidationError);

    const deliverable = await createDeliverable(admin, {
      projectId: project.id,
      title: "Avec document",
      documentId: document.id,
    });
    await submitDeliverable(admin, { deliverableId: deliverable.id });
    await expect(
      updateDeliverable(admin, {
        deliverableId: deliverable.id,
        title: "Avec document",
        documentId: "",
      }),
    ).rejects.toThrow(ConflictError);
    const renamed = await updateDeliverable(admin, {
      deliverableId: deliverable.id,
      title: "Renommé",
      documentId: document.id,
      requiresClientValidation: "on",
    });
    expect(renamed.title).toBe("Renommé");
  });

  it("applique les droits par rôle", async () => {
    const { deliverable, project } = await submitted();
    await expect(createDeliverable(viewer, { projectId: project.id, title: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(submitDeliverable(viewer, { deliverableId: deliverable.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      recordDeliverableReview(contractor, { deliverableId: deliverable.id, decision: "validated" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("se joint à la transaction de l'appelant : annulée, rien n'est écrit", async () => {
    const { company, deliverable } = await submitted();
    const client = await createPortalTestContext(db, { company });
    await expect(
      db.transaction(async (tx) => {
        await recordDeliverableReview(
          client,
          { deliverableId: deliverable.id, decision: "validated" },
          { tx },
        );
        throw new Error("annulation");
      }),
    ).rejects.toThrow("annulation");
    const reviews = await db
      .select()
      .from(schema.deliverableReviews)
      .where(eq(schema.deliverableReviews.deliverableId, deliverable.id));
    expect(reviews).toHaveLength(0);
  });
});

describe("contenus attendus", () => {
  it("le client marque le sien reçu ; répéter ne change pas la date", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const requirement = await createRequirement(admin, {
      projectId: project.id,
      label: "Photos",
      dueOn: "2026-11-10",
    });
    const client = await createPortalTestContext(db, { company });
    const received = await markRequirementReceived(client, { requirementId: requirement.id });
    expect(received.status).toBe("received");
    expect(received.receivedAt).toBeInstanceOf(Date);
    const again = await markRequirementReceived(client, { requirementId: requirement.id });
    expect(again.receivedAt).toEqual(received.receivedAt);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, requirement.id));
    expect(audit.filter((row) => row.action === "client_requirement.received")).toHaveLength(1);
  });

  it("refuse le contenu d'un autre client (404) et un document d'un autre projet", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const requirement = await createRequirement(admin, { projectId: project.id, label: "Textes" });
    const stranger = await createPortalTestContext(db);
    await expect(
      markRequirementReceived(stranger, { requirementId: requirement.id }),
    ).rejects.toThrow(NotFoundError);
    const { document } = await createDocument(db);
    await expect(
      markRequirementReceived(admin, { requirementId: requirement.id, documentId: document.id }),
    ).rejects.toThrow(ValidationError);
  });

  it("modifie, rouvre, et refuse les rôles sans droit", async () => {
    const project = await createProject(db);
    const requirement = await createRequirement(admin, { projectId: project.id, label: "Logo" });
    await expect(createRequirement(viewer, { projectId: project.id, label: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      markRequirementReceived(contractor, { requirementId: requirement.id }),
    ).rejects.toThrow(ForbiddenError);
    const updated = await updateRequirement(admin, {
      requirementId: requirement.id,
      label: "Logo vectoriel",
      dueOn: "2026-12-01",
    });
    expect(updated).toMatchObject({ label: "Logo vectoriel", dueOn: "2026-12-01" });
    await markRequirementReceived(admin, { requirementId: requirement.id });
    const reopened = await reopenRequirement(admin, { requirementId: requirement.id });
    expect(reopened).toMatchObject({ status: "expected", receivedAt: null });
  });
});

describe("blocages", () => {
  it("garde conséquence et décision ; lever deux fois ne change rien", async () => {
    const project = await createProject(db);
    const blocker = await raiseBlocker(admin, {
      projectId: project.id,
      title: "Photos non reçues",
      consequence: "La galerie décale de 2 jours",
    });
    const decided = await updateBlocker(admin, {
      blockerId: blocker.id,
      title: "Photos non reçues",
      consequence: "La galerie décale de 2 jours",
      decision: "Mise en ligne repoussée",
    });
    expect(decided.decision).toBe("Mise en ligne repoussée");
    const resolved = await resolveBlocker(admin, { blockerId: blocker.id });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    const again = await resolveBlocker(admin, { blockerId: blocker.id });
    expect(again.resolvedAt).toEqual(resolved.resolvedAt);
  });

  it("refuse les rôles sans droit", async () => {
    const project = await createProject(db);
    await expect(raiseBlocker(viewer, { projectId: project.id, title: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(raiseBlocker(contractor, { projectId: project.id, title: "x" })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("demandes de changement", () => {
  it("accepter crée les travaux et augmente l'enveloppe, une seule fois", async () => {
    const project = await createProject(db, {
      status: "active",
      budgetCents: 100_000,
      estimatedMinutes: 1000,
    });
    const changeRequest = await createChangeRequest(admin, {
      projectId: project.id,
      title: "Page Galerie en plus",
      estimatedMinutes: 480,
      amountCents: 50_000,
    });
    expect(changeRequest).toMatchObject({ status: "open", companyId: project.companyId });

    const accepted = await acceptChangeRequest(admin, { changeRequestId: changeRequest.id });
    expect(accepted.status).toBe("accepted");
    await acceptChangeRequest(admin, { changeRequestId: changeRequest.id });

    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, project.id));
    expect(row).toMatchObject({ budgetCents: 150_000, estimatedMinutes: 1480 });
    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, project.id));
    expect(tasks.map((task) => task.title)).toEqual(["Page Galerie en plus"]);
    expect(tasks[0]?.estimatedMinutes).toBe(480);
  });

  it("une décision est définitive", async () => {
    const project = await createProject(db);
    const changeRequest = await createChangeRequest(admin, { projectId: project.id, title: "x" });
    await refuseChangeRequest(admin, { changeRequestId: changeRequest.id });
    await refuseChangeRequest(admin, { changeRequestId: changeRequest.id });
    await expect(acceptChangeRequest(admin, { changeRequestId: changeRequest.id })).rejects.toThrow(
      ConflictError,
    );
    await expect(
      updateChangeRequest(admin, { changeRequestId: changeRequest.id, title: "y" }),
    ).rejects.toThrow(ConflictError);
  });

  it("se transforme en devis du même client seulement", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const changeRequest = await createChangeRequest(admin, { projectId: project.id, title: "x" });
    const { quote: foreign } = await createQuote(db);
    await expect(
      linkChangeRequestQuote(admin, { changeRequestId: changeRequest.id, quoteId: foreign.id }),
    ).rejects.toThrow(ConflictError);
    const { quote } = await createQuote(db, { companyId: company.id });
    const converted = await linkChangeRequestQuote(admin, {
      changeRequestId: changeRequest.id,
      quoteId: quote.id,
    });
    expect(converted).toMatchObject({ status: "converted", quoteId: quote.id });
    const again = await linkChangeRequestQuote(admin, {
      changeRequestId: changeRequest.id,
      quoteId: quote.id,
    });
    expect(again.id).toBe(converted.id);
  });

  it("refuse un lien croisé entre clients", async () => {
    const project = await createProject(db);
    const other = await createCompany(db);
    await expect(
      createChangeRequest(admin, { projectId: project.id, companyId: other.id, title: "x" }),
    ).rejects.toThrow(ConflictError);
    const ticket = await createTicket(db, { companyId: other.id });
    await expect(
      createChangeRequest(admin, { projectId: project.id, ticketId: ticket.id, title: "x" }),
    ).rejects.toThrow(ConflictError);
  });

  it("depuis un ticket, ne crée pas de doublon et se lit sur la fiche client", async () => {
    const company = await createCompany(db);
    const ticket = await createTicket(db, { companyId: company.id });
    const input = { companyId: company.id, ticketId: ticket.id, title: "Hors forfait" };
    const first = await createChangeRequest(admin, input);
    const second = await createChangeRequest(admin, input);
    expect(second.id).toBe(first.id);
    const rows = await listChangeRequestsForCompany(admin, company.id, { limit: 5 });
    expect(rows.map((row) => row.id)).toEqual([first.id]);
  });

  it("exige un rattachement, et refuse les rôles sans droit", async () => {
    await expect(createChangeRequest(admin, { title: "Sans rien" })).rejects.toThrow(
      ValidationError,
    );
    const project = await createProject(db);
    await expect(
      createChangeRequest(viewer, { projectId: project.id, title: "x" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createChangeRequest(contractor, { projectId: project.id, title: "x" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("passation", () => {
  it("ajoute, coche et décoche, sans répétition au journal", async () => {
    const project = await createProject(db);
    const item = await addHandoverItem(admin, { projectId: project.id, label: "Accès remis" });
    const done = await toggleHandoverItem(admin, { itemId: item.id, done: true });
    expect(done.doneAt).toBeInstanceOf(Date);
    await toggleHandoverItem(admin, { itemId: item.id, done: true });
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, item.id));
    expect(audit.filter((row) => row.action === "handover_item.done")).toHaveLength(1);
    const reopened = await toggleHandoverItem(admin, { itemId: item.id, done: false });
    expect(reopened.doneAt).toBeNull();
    await expect(toggleHandoverItem(viewer, { itemId: item.id, done: true })).rejects.toThrow(
      ForbiddenError,
    );
  });
});
