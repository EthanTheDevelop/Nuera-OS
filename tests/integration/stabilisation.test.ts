import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDocumentReadable,
  getDocumentDetail,
  listDocumentsForPortal,
  openDocumentDownload,
  searchDocuments,
  updateDocument,
  uploadDocument,
} from "@/modules/documents/document.service";
import {
  archiveDirectCost,
  archiveScheduleItem,
  createDirectCost,
  createScheduleItem,
  getFinanceSummary,
  listDirectCosts,
  listSchedule,
} from "@/modules/finance/finance.service";
import { getMargin } from "@/modules/finance/profitability.service";
import { logTicketTime } from "@/modules/support/ticket.service";
import { convertChangeRequestToQuote } from "@/modules/projects/change-request.conversion";
import {
  acceptChangeRequest,
  addHandoverItem,
  archiveDeliverable,
  archiveHandoverItem,
  archivePhase,
  archiveRequirement,
  changePhaseStatus,
  createChangeRequest,
  createDeliverable,
  createPhase,
  createRequirement,
  markRequirementReceived,
  recordDeliverableReview,
  submitDeliverable,
  toggleHandoverItem,
  updatePhase,
} from "@/modules/projects/production.service";
import {
  changeProjectStatus,
  getProjectDetail,
  raiseProjectBudgetFromAmendment,
} from "@/modules/projects/project.service";
import {
  acceptQuoteManually,
  markQuoteSentManually,
  processDocusealWebhook,
} from "@/modules/quotes/quote-signature.service";
import {
  createAmendment,
  createQuote,
  getQuoteDetail,
  saveQuoteContent,
} from "@/modules/quotes/quote.service";
import { parisDay } from "@/modules/projects/project.rules";
import { getTaskDetail } from "@/modules/projects/task.service";
import { createTimeEntry, updateTimeEntry } from "@/modules/time/time.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { NotFoundError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../helpers/db";
import {
  createCompany,
  createMemberContext,
  createPortalTestContext,
  createProject,
  createTask,
  createTicket,
} from "../helpers/factories";
import { createTempStorage, PDF_BYTES, pdfWith, streamOf } from "./documents/helpers";
import { content, createFixture, LINE, UNCONFIGURED_DEPS, type Fixture } from "./quotes/helpers";

/** Décisions de la stabilisation, entre plusieurs modules. */
let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let member: ServiceContext;
const PAGE = { page: 1, pageSize: 50 };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createTestContext(db, "admin");
  member = await createTestContext(db, "member");
});
afterAll(() => close());

const auditCount = async (entityId: string, action: string) =>
  (
    await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, action)))
  ).length;

describe("archivage : finances", () => {
  it("un coût archivé sort de la marge, des listes et reste tracé", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const cost = await createDirectCost(admin, {
      companyId: company.id,
      projectId: project.id,
      label: "Licence à retirer",
      category: "license",
      amountCents: "12300",
      incurredOn: "2026-10-01",
      nature: "actual",
    });
    const before = await getMargin(db, { scope: "project", id: project.id });
    expect(before.actual.directCostCents).toBe(12300);

    await archiveDirectCost(admin, cost.id);

    const [row] = await db
      .select()
      .from(schema.directCosts)
      .where(eq(schema.directCosts.id, cost.id));
    expect(row?.archivedAt).not.toBeNull();
    const after = await getMargin(db, { scope: "project", id: project.id });
    expect(after.actual.directCostCents).toBe(0);
    const list = await listDirectCosts(admin, { search: "Licence à retirer" }, PAGE);
    expect(list.items).toEqual([]);
    expect(await auditCount(cost.id, "direct_cost.archived")).toBe(1);
  });

  it("une échéance archivée sort de l'échéancier et du reste à facturer", async () => {
    const company = await createCompany(db);
    const summaryOf = () =>
      getFinanceSummary(db, { from: "2026-01-01", to: "2026-12-31" }, new Date());
    const before = (await summaryOf()).plannedScheduleCents;
    const item = await createScheduleItem(admin, {
      companyId: company.id,
      label: "Solde erroné",
      amountCents: "5000",
      dueOn: "2026-12-01",
    });
    expect((await summaryOf()).plannedScheduleCents).toBe(before + 5000);

    await archiveScheduleItem(admin, item.id);

    expect((await summaryOf()).plannedScheduleCents).toBe(before);
    const list = await listSchedule(admin, { search: "Solde erroné" }, PAGE);
    expect(list.items).toEqual([]);
    await expect(archiveScheduleItem(admin, item.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await auditCount(item.id, "schedule_item.archived")).toBe(1);
  });
});

describe("archivage : projet", () => {
  async function activeProject() {
    return createProject(db, { status: "active" });
  }

  it("un jalon vide s'archive ; démarré ou avec des tâches, il est refusé", async () => {
    const project = await activeProject();
    const empty = await createPhase(admin, { projectId: project.id, name: "Par erreur" });
    await archivePhase(admin, { phaseId: empty.id });
    const detail = await getProjectDetail(admin, project.id);
    expect(detail.phases.map((phase) => phase.id)).not.toContain(empty.id);
    expect(await auditCount(empty.id, "project_phase.archived")).toBe(1);
    await expect(updatePhase(admin, { phaseId: empty.id, name: "Encore" })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const withTask = await createPhase(admin, { projectId: project.id, name: "Avec tâche" });
    await createTask(db, { projectId: project.id, phaseId: withTask.id });
    await expect(archivePhase(admin, { phaseId: withTask.id })).rejects.toThrow(/1 tâche/);

    const withDeliverable = await createPhase(admin, { projectId: project.id, name: "Livrable" });
    await createDeliverable(admin, {
      projectId: project.id,
      title: "Maquette",
      phaseId: withDeliverable.id,
    });
    await expect(archivePhase(admin, { phaseId: withDeliverable.id })).rejects.toThrow(
      /1 livrable/,
    );

    const started = await createPhase(admin, { projectId: project.id, name: "Démarré" });
    await changePhaseStatus(admin, { phaseId: started.id, status: "in_progress" });
    await expect(archivePhase(admin, { phaseId: started.id })).rejects.toThrow(/déjà démarré/);
  });

  it("un brouillon de livrable s'archive ; soumis ou relu, il est refusé", async () => {
    const project = await activeProject();
    const draft = await createDeliverable(admin, { projectId: project.id, title: "Doublon" });
    await archiveDeliverable(admin, { deliverableId: draft.id });
    const detail = await getProjectDetail(admin, project.id);
    expect(detail.deliverables.map((item) => item.id)).not.toContain(draft.id);
    expect(await auditCount(draft.id, "deliverable.archived")).toBe(1);

    const reviewed = await createDeliverable(admin, {
      projectId: project.id,
      title: "Relu",
      requiresClientValidation: "on",
    });
    await submitDeliverable(admin, { deliverableId: reviewed.id });
    await expect(archiveDeliverable(admin, { deliverableId: reviewed.id })).rejects.toThrow(
      /soumis/,
    );
    await recordDeliverableReview(admin, {
      deliverableId: reviewed.id,
      decision: "changes_requested",
      comment: "À reprendre",
    });
    await expect(archiveDeliverable(admin, { deliverableId: reviewed.id })).rejects.toThrow(
      /relecture du client/,
    );
  });

  it("un livrable archivé n'empêche plus la livraison", async () => {
    const project = await createProject(db, { status: "in_validation" });
    const draft = await createDeliverable(admin, {
      projectId: project.id,
      title: "Pas vraiment attendu",
      requiresClientValidation: "on",
    });
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "delivered" }),
    ).rejects.toThrow(/Validation client en attente/);
    await archiveDeliverable(admin, { deliverableId: draft.id });
    const delivered = await changeProjectStatus(admin, {
      projectId: project.id,
      status: "delivered",
    });
    expect(delivered.status).toBe("delivered");
  });

  it("un contenu attendu s'archive ; reçu, il est refusé", async () => {
    const project = await activeProject();
    const requirement = await createRequirement(admin, { projectId: project.id, label: "Logo" });
    await archiveRequirement(admin, { requirementId: requirement.id });
    expect((await getProjectDetail(admin, project.id)).requirements).toEqual([]);
    expect(await auditCount(requirement.id, "client_requirement.archived")).toBe(1);

    const received = await createRequirement(admin, { projectId: project.id, label: "Textes" });
    await markRequirementReceived(admin, { requirementId: received.id });
    await expect(archiveRequirement(admin, { requirementId: received.id })).rejects.toThrow(
      /déjà été reçu/,
    );
  });

  it("un point de passation s'archive, libère la clôture ; validé, il est refusé", async () => {
    const project = await createProject(db, { status: "delivered" });
    const extra = await addHandoverItem(admin, { projectId: project.id, label: "Par erreur" });
    const done = await addHandoverItem(admin, { projectId: project.id, label: "Accès remis" });
    await toggleHandoverItem(admin, { itemId: done.id, done: true });
    await expect(archiveHandoverItem(admin, { itemId: done.id })).rejects.toThrow(/déjà validé/);
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "closed" }),
    ).rejects.toThrow(/passation/);

    await archiveHandoverItem(admin, { itemId: extra.id });
    expect((await getProjectDetail(admin, project.id)).handover.map((item) => item.id)).toEqual([
      done.id,
    ]);
    await changeProjectStatus(admin, { projectId: project.id, status: "closed" });
    expect(await auditCount(extra.id, "handover_item.archived")).toBe(1);
  });

  it("la lecture seule n'archive rien", async () => {
    const viewer = await createTestContext(db, "viewer");
    const project = await activeProject();
    const phase = await createPhase(admin, { projectId: project.id, name: "Protégé" });
    await expect(archivePhase(viewer, { phaseId: phase.id })).rejects.toThrow();
  });
});

describe("documents de type facture", () => {
  let temp: Awaited<ReturnType<typeof createTempStorage>>;
  let deps: { storage: typeof temp.storage; maxBytes: number };
  let counter = 0;
  const bytes = () => pdfWith(`facture ${(counter += 1)}`);

  beforeAll(async () => {
    temp = await createTempStorage();
    deps = { storage: temp.storage, maxBytes: 1024 * 1024 };
  });
  afterAll(() => temp.cleanup());

  it("sans finance:read : 404 partout, sauf pour la personne qui l'a déposée", async () => {
    const uploader = await createTestContext(db, "member");
    const other = await createTestContext(db, "member");
    const viewer = await createTestContext(db, "viewer");
    const { document } = await uploadDocument(
      uploader,
      { title: "Facture Dupont", filename: "f.pdf", kind: "invoice" },
      streamOf(bytes()),
      deps,
    );

    await expect(assertDocumentReadable(uploader, document.id)).resolves.toMatchObject({
      id: document.id,
    });
    await expect(getDocumentDetail(admin, document.id)).resolves.toBeTruthy();
    await expect(openDocumentDownload(admin, document.id, {}, deps)).resolves.toBeTruthy();

    for (const ctx of [other, viewer]) {
      await expect(assertDocumentReadable(ctx, document.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getDocumentDetail(ctx, document.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(openDocumentDownload(ctx, document.id, {}, deps)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      const list = await searchDocuments(ctx, { search: "Facture Dupont" });
      expect(list.items).toEqual([]);
    }
    expect((await searchDocuments(uploader, { search: "Facture Dupont" })).items).toHaveLength(1);
    expect((await searchDocuments(admin, { search: "Facture Dupont" })).items).toHaveLength(1);

    await expect(
      updateDocument(other, { id: document.id, title: "Renommée", kind: "invoice" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sur la fiche d'un projet et d'une tâche, le titre ne sort pas non plus", async () => {
    const uploader = await createTestContext(db, "member");
    const other = await createTestContext(db, "member");
    const project = await createProject(db, { status: "active" });
    const task = await createTask(db, { projectId: project.id });
    await uploadDocument(
      uploader,
      {
        title: "Facture du projet",
        filename: "f.pdf",
        kind: "invoice",
        companyId: project.companyId,
        projectId: project.id,
      },
      streamOf(bytes()),
      deps,
    );

    const titles = async (ctx: ServiceContext) => ({
      project: (await getProjectDetail(ctx, project.id)).documents.map((row) => row.title),
      task: (await getTaskDetail(ctx, task.id)).options.documents.map((row) => row.title),
    });
    const both = { project: ["Facture du projet"], task: ["Facture du projet"] };
    expect(await titles(admin)).toEqual(both);
    expect(await titles(uploader)).toEqual(both);
    expect(await titles(other)).toEqual({ project: [], task: [] });
  });

  it("un autre type de document reste lisible par tous les rôles internes", async () => {
    const other = await createTestContext(db, "member");
    const { document } = await uploadDocument(
      member,
      { title: "Brief", filename: "b.pdf", kind: "brief" },
      streamOf(bytes()),
      deps,
    );
    await expect(assertDocumentReadable(other, document.id)).resolves.toBeTruthy();
  });

  it("le client lit sa facture partagée, et elle seule", async () => {
    const company = await createCompany(db);
    const portal = await createPortalTestContext(db, { company });
    const stranger = await createPortalTestContext(db);
    const shared = await uploadDocument(
      admin,
      { title: "Facture partagée", filename: "p.pdf", kind: "invoice", companyId: company.id },
      streamOf(PDF_BYTES),
      deps,
    );
    await db
      .update(schema.documents)
      .set({ visibility: "client" })
      .where(eq(schema.documents.id, shared.document.id));
    const internal = await uploadDocument(
      admin,
      { title: "Facture interne", filename: "i.pdf", kind: "invoice", companyId: company.id },
      streamOf(bytes()),
      deps,
    );

    await expect(assertDocumentReadable(portal, shared.document.id)).resolves.toBeTruthy();
    const list = await listDocumentsForPortal(portal);
    expect(list.items.map((row) => row.id)).toEqual([shared.document.id]);
    await expect(assertDocumentReadable(portal, internal.document.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(assertDocumentReadable(stranger, shared.document.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("avenants : budget et temps prévus du projet", () => {
  const deps = UNCONFIGURED_DEPS;
  const ACCEPTANCE = { indyReference: "INDY-9", signedOn: "2026-01-15" };
  const ORIGIN = { budgetCents: LINE.unitPriceCents, minutes: LINE.estimatedMinutes };
  const EXTRA = { ...LINE, label: "Page Galerie", unitPriceCents: 60_000, estimatedMinutes: 480 };
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture(db);
  });

  /** Devis d'origine accepté, avec son projet. */
  async function signedOrigin() {
    const company = await createCompany(db);
    const quote = await createQuote(fixture.member, { companyId: company.id, title: "Vitrine" });
    await saveQuoteContent(fixture.member, quote.id, content(), deps);
    await markQuoteSentManually(fixture.member, quote.id);
    const { projectId } = await acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps);
    if (!projectId) throw new Error("Projet non créé.");
    return { quote, projectId, companyId: company.id };
  }

  const figures = async (projectId: string) => {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    return { budgetCents: row?.budgetCents, minutes: row?.estimatedMinutes };
  };

  async function sentAmendment(originId: string, options: { changeRequestId?: string } = {}) {
    const amendment = await createAmendment(fixture.member, originId, {
      title: "Avenant",
      ...options,
    });
    await saveQuoteContent(fixture.member, amendment.id, content({ lines: [EXTRA] }), deps);
    await markQuoteSentManually(fixture.member, amendment.id);
    return amendment;
  }

  it("acceptation manuelle : augmente une seule fois, tracé", async () => {
    const { quote, projectId } = await signedOrigin();
    const amendment = await sentAmendment(quote.id);
    expect(await figures(projectId)).toEqual(ORIGIN);

    await acceptQuoteManually(fixture.member, amendment.id, ACCEPTANCE, deps);
    const raised = { budgetCents: ORIGIN.budgetCents + 60_000, minutes: ORIGIN.minutes + 480 };
    expect(await figures(projectId)).toEqual(raised);

    // Répéter l'acceptation, ou rappeler directement la fonction, ne change rien.
    await acceptQuoteManually(fixture.member, amendment.id, ACCEPTANCE, deps);
    const detail = await getQuoteDetail(fixture.member, amendment.id);
    await db.transaction(async (tx) =>
      raiseProjectBudgetFromAmendment({ ...fixture.member, db: tx }, tx, {
        quoteId: amendment.id,
        parentQuoteId: quote.id,
        versionId: detail.version.id,
        companyId: quote.companyId,
        auditActorId: fixture.member.actor.userId,
      }),
    );
    expect(await figures(projectId)).toEqual(raised);
    expect(await auditCount(projectId, "project.budget_raised")).toBe(1);
  });

  it("signature par webhook : un rejeu n'augmente pas une seconde fois", async () => {
    const { quote, projectId } = await signedOrigin();
    const amendment = await sentAmendment(quote.id);
    const submissionId = `sub-${crypto.randomUUID()}`;
    await db
      .update(schema.quotes)
      .set({ docusealSubmissionId: submissionId, signatureStatus: "pending" })
      .where(eq(schema.quotes.id, amendment.id));
    const event = {
      type: "submission.completed" as const,
      receiptId: `submission.completed:${submissionId}`,
      submissionId,
      externalIds: [],
      completedAt: new Date("2026-11-02T10:00:00Z"),
    };
    const base = { db, crm: fixture.crm };

    await expect(processDocusealWebhook(base, event)).resolves.toBe("processed");
    const raised = { budgetCents: ORIGIN.budgetCents + 60_000, minutes: ORIGIN.minutes + 480 };
    expect(await figures(projectId)).toEqual(raised);

    // Même livraison, puis même événement sous un autre identifiant de reçu.
    await expect(processDocusealWebhook(base, event)).resolves.toBe("duplicate");
    await expect(
      processDocusealWebhook(base, { ...event, receiptId: `${event.receiptId}:bis` }),
    ).resolves.toBe("processed");
    expect(await figures(projectId)).toEqual(raised);
    expect(await auditCount(projectId, "project.budget_raised")).toBe(1);
  });

  it("demande déjà acceptée dans le projet : l'avenant n'ajoute rien", async () => {
    const { quote, projectId, companyId } = await signedOrigin();
    const request = await createChangeRequest(fixture.member, {
      companyId,
      projectId,
      title: "Page Galerie",
      amountCents: "60000",
      estimatedMinutes: "480",
    });
    await acceptChangeRequest(fixture.member, { changeRequestId: request.id });
    const counted = { budgetCents: ORIGIN.budgetCents + 60_000, minutes: ORIGIN.minutes + 480 };
    expect(await figures(projectId)).toEqual(counted);

    const amendment = await sentAmendment(quote.id, { changeRequestId: request.id });
    await acceptQuoteManually(fixture.member, amendment.id, ACCEPTANCE, deps);
    expect(await figures(projectId)).toEqual(counted);
    expect(await auditCount(projectId, "project.budget_raised")).toBe(0);
  });

  it("demande transformée sans acceptation : c'est l'avenant signé qui augmente", async () => {
    const { projectId, companyId } = await signedOrigin();
    const request = await createChangeRequest(fixture.member, {
      companyId,
      projectId,
      title: "Module de réservation",
      amountCents: "90000",
      estimatedMinutes: "600",
    });
    const { quoteId } = await convertChangeRequestToQuote(
      fixture.member,
      { changeRequestId: request.id },
      deps,
    );
    expect(await figures(projectId)).toEqual(ORIGIN);

    await saveQuoteContent(
      fixture.member,
      quoteId,
      content({ lines: [{ ...EXTRA, unitPriceCents: 90_000, estimatedMinutes: 600 }] }),
      deps,
    );
    await markQuoteSentManually(fixture.member, quoteId);
    await acceptQuoteManually(fixture.member, quoteId, ACCEPTANCE, deps);
    expect(await figures(projectId)).toEqual({
      budgetCents: ORIGIN.budgetCents + 90_000,
      minutes: ORIGIN.minutes + 600,
    });
    expect(await auditCount(projectId, "project.budget_raised")).toBe(1);
  });

  it("un projet clôturé reçoit quand même l'avenant signé", async () => {
    const { quote, projectId } = await signedOrigin();
    const amendment = await sentAmendment(quote.id);
    await db
      .update(schema.projects)
      .set({ status: "closed" })
      .where(eq(schema.projects.id, projectId));
    await acceptQuoteManually(fixture.member, amendment.id, ACCEPTANCE, deps);
    expect((await figures(projectId)).budgetCents).toBe(ORIGIN.budgetCents + 60_000);
  });
});

describe("temps sur une demande clôturée", () => {
  it("createTimeEntry refuse, comme logTicketTime, et une saisie existante se corrige", async () => {
    const worker = await createMemberContext(db, "member");
    const ticket = await createTicket(db, { status: "in_progress" });
    const other = await createTicket(db, { status: "closed" });
    const today = parisDay();

    const existing = await createTimeEntry(worker, {
      ticketId: ticket.id,
      category: "support",
      minutes: 30,
      workOn: today,
    });
    await db
      .update(schema.tickets)
      .set({ status: "closed" })
      .where(eq(schema.tickets.id, ticket.id));

    const message = "Le temps d'une demande clôturée est déjà imputé.";
    await expect(
      createTimeEntry(worker, {
        ticketId: ticket.id,
        category: "support",
        minutes: 15,
        workOn: today,
      }),
    ).rejects.toThrow(message);
    await expect(
      logTicketTime(worker, { ticketId: ticket.id, minutes: 15, workOn: today, billable: false }),
    ).rejects.toThrow(message);

    // La saisie déjà imputée reste modifiable, mais rien ne s'ajoute à une autre demande close.
    await expect(
      updateTimeEntry(worker, existing.id, {
        ticketId: ticket.id,
        category: "support",
        minutes: 45,
        workOn: today,
      }),
    ).resolves.toMatchObject({ changed: true });
    await expect(
      updateTimeEntry(worker, existing.id, {
        ticketId: other.id,
        category: "support",
        minutes: 45,
        workOn: today,
      }),
    ).rejects.toThrow(message);
  });
});
