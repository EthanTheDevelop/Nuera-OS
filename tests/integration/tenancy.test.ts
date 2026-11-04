import type { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isForeignKeyViolation, isUniqueViolation } from "@/server/db/errors";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { prefixTsQuery } from "@/server/pagination";
import { createTestDatabase } from "../helpers/db";
import {
  createCompany,
  createContact,
  createContract,
  createConversation,
  createDocument,
  createOpportunity,
  createPhase,
  createPortalClient,
  createProject,
  createQuote,
  createSite,
  createTask,
  createTeamMember,
  createTicket,
} from "../helpers/factories";

/**
 * Cloisonnement en SQL (`docs/domain-model.md` §2) : un lien vers l'objet d'un autre client est
 * refusé par la base elle-même, pas seulement par les services.
 */
let db: Database;
let client: PGlite;
let close: () => Promise<void>;

/** Les objets du client B, que les insertions du client A tentent de référencer. */
let w: Awaited<ReturnType<typeof buildWorld>>;

async function buildWorld() {
  const a = await createCompany(db, { name: "Client A" });
  const b = await createCompany(db, { name: "Client B" });
  const contact = await createContact(db, { companyId: b.id });
  const opportunity = await createOpportunity(db, { companyId: b.id });
  const { quote, version } = await createQuote(db, { companyId: b.id });
  const project = await createProject(db, { companyId: b.id });
  const phase = await createPhase(db, { projectId: project.id });
  const task = await createTask(db, { projectId: project.id });
  const site = await createSite(db, { companyId: b.id });
  const contract = await createContract(db, { companyId: b.id });
  const ticket = await createTicket(db, { companyId: b.id });
  const { document } = await createDocument(db, { companyId: b.id, projectId: project.id });
  const conversation = await createConversation(db, { companyId: b.id });
  const [changeRequest] = await db
    .insert(s.changeRequests)
    .values({ companyId: b.id, title: "Demande B" })
    .returning();
  const [scheduleItem] = await db
    .insert(s.paymentScheduleItems)
    .values({ companyId: b.id, label: "Échéance B", amountCents: 100 })
    .returning();
  const [financialDocument] = await db
    .insert(s.financialDocuments)
    .values({ companyId: b.id, source: "manual", amountCents: 100 })
    .returning();
  const member = await createTeamMember(db);
  const [user] = await db
    .insert(s.users)
    .values({ name: "Client A", email: `portal-${crypto.randomUUID()}@test.local`, role: "client" })
    .returning();
  if (!changeRequest || !scheduleItem || !financialDocument || !user) {
    throw new Error("Monde de test incomplet");
  }
  return {
    aId: a.id,
    bId: b.id,
    contactId: contact.id,
    opportunityId: opportunity.id,
    quoteId: quote.id,
    versionId: version.id,
    projectId: project.id,
    phaseId: phase.id,
    taskId: task.id,
    siteId: site.id,
    contractId: contract.id,
    ticketId: ticket.id,
    documentId: document.id,
    conversationId: conversation.id,
    changeRequestId: changeRequest.id,
    scheduleItemId: scheduleItem.id,
    financialDocumentId: financialDocument.id,
    memberId: member.id,
    userId: user.id,
  };
}

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
  w = await buildWorld();
});
afterAll(async () => close());

type Attempt = () => Promise<unknown>;

/** `[contrainte, insertion du client A vers un objet du client B]`, lien par lien. */
const CROSS_COMPANY_LINKS: readonly [string, Attempt][] = [
  [
    "opportunities_contact_company_fk",
    () =>
      db.insert(s.opportunities).values({
        twentyId: "x1",
        name: "x",
        companyId: w.aId,
        contactId: w.contactId,
      }),
  ],
  [
    "activities_contact_company_fk",
    () =>
      db
        .insert(s.activities)
        .values({ kind: "note", subject: "x", companyId: w.aId, contactId: w.contactId }),
  ],
  [
    "activities_opportunity_company_fk",
    () =>
      db
        .insert(s.activities)
        .values({ kind: "note", subject: "x", companyId: w.aId, opportunityId: w.opportunityId }),
  ],
  [
    "quotes_opportunity_company_fk",
    () =>
      db
        .insert(s.quotes)
        .values({ number: "x", title: "x", companyId: w.aId, opportunityId: w.opportunityId }),
  ],
  [
    "quotes_parent_company_fk",
    () =>
      db
        .insert(s.quotes)
        .values({ number: "x", title: "x", companyId: w.aId, parentQuoteId: w.quoteId }),
  ],
  [
    "projects_opportunity_company_fk",
    () =>
      db
        .insert(s.projects)
        .values({ number: "x", name: "x", companyId: w.aId, opportunityId: w.opportunityId }),
  ],
  [
    "projects_quote_company_fk",
    () =>
      db
        .insert(s.projects)
        .values({ number: "x", name: "x", companyId: w.aId, quoteId: w.quoteId }),
  ],
  [
    "change_requests_project_company_fk",
    () =>
      db.insert(s.changeRequests).values({ title: "x", companyId: w.aId, projectId: w.projectId }),
  ],
  [
    "change_requests_ticket_company_fk",
    () =>
      db.insert(s.changeRequests).values({ title: "x", companyId: w.aId, ticketId: w.ticketId }),
  ],
  [
    "change_requests_quote_company_fk",
    () => db.insert(s.changeRequests).values({ title: "x", companyId: w.aId, quoteId: w.quoteId }),
  ],
  [
    "missions_project_company_fk",
    () =>
      db
        .insert(s.missions)
        .values({ title: "x", memberId: w.memberId, companyId: w.aId, projectId: w.projectId }),
  ],
  [
    "missions_ticket_company_fk",
    () =>
      db
        .insert(s.missions)
        .values({ title: "x", memberId: w.memberId, companyId: w.aId, ticketId: w.ticketId }),
  ],
  [
    "time_entries_project_company_fk",
    () =>
      db.insert(s.timeEntries).values({
        memberId: w.memberId,
        companyId: w.aId,
        projectId: w.projectId,
        workOn: "2026-11-04",
        minutes: 30,
        category: "production",
      }),
  ],
  [
    "time_entries_ticket_company_fk",
    () =>
      db.insert(s.timeEntries).values({
        memberId: w.memberId,
        companyId: w.aId,
        ticketId: w.ticketId,
        workOn: "2026-11-04",
        minutes: 30,
        category: "support",
      }),
  ],
  [
    "time_entries_contract_company_fk",
    () =>
      db.insert(s.timeEntries).values({
        memberId: w.memberId,
        companyId: w.aId,
        contractId: w.contractId,
        workOn: "2026-11-04",
        minutes: 30,
        category: "support",
      }),
  ],
  [
    "sites_project_company_fk",
    () => db.insert(s.sites).values({ name: "x", companyId: w.aId, projectId: w.projectId }),
  ],
  [
    "sites_contract_company_fk",
    () => db.insert(s.sites).values({ name: "x", companyId: w.aId, contractId: w.contractId }),
  ],
  [
    "domains_site_company_fk",
    () =>
      db
        .insert(s.domains)
        .values({ name: `x-${crypto.randomUUID()}`, companyId: w.aId, siteId: w.siteId }),
  ],
  [
    "contracts_quote_company_fk",
    () =>
      db
        .insert(s.contracts)
        .values({ number: "x", name: "x", kind: "hosting", companyId: w.aId, quoteId: w.quoteId }),
  ],
  [
    "contract_sites_contract_company_fk",
    () =>
      db
        .insert(s.contractSites)
        .values({ contractId: w.contractId, siteId: w.siteId, companyId: w.aId }),
  ],
  [
    "maintenance_interventions_contract_company_fk",
    () =>
      db
        .insert(s.maintenanceInterventions)
        .values({ title: "x", companyId: w.aId, contractId: w.contractId }),
  ],
  [
    "tickets_site_company_fk",
    () =>
      db.insert(s.tickets).values({
        number: "x",
        subject: "x",
        channel: "email",
        category: "bug",
        companyId: w.aId,
        siteId: w.siteId,
      }),
  ],
  [
    "tickets_contract_company_fk",
    () =>
      db.insert(s.tickets).values({
        number: "x",
        subject: "x",
        channel: "email",
        category: "bug",
        companyId: w.aId,
        contractId: w.contractId,
      }),
  ],
  [
    "tickets_project_company_fk",
    () =>
      db.insert(s.tickets).values({
        number: "x",
        subject: "x",
        channel: "email",
        category: "bug",
        companyId: w.aId,
        projectId: w.projectId,
      }),
  ],
  [
    "tickets_change_request_company_fk",
    () =>
      db.insert(s.tickets).values({
        number: "x",
        subject: "x",
        channel: "email",
        category: "bug",
        companyId: w.aId,
        changeRequestId: w.changeRequestId,
      }),
  ],
  [
    "financial_documents_project_company_fk",
    () =>
      db
        .insert(s.financialDocuments)
        .values({ source: "manual", amountCents: 1, companyId: w.aId, projectId: w.projectId }),
  ],
  [
    "financial_documents_contract_company_fk",
    () =>
      db
        .insert(s.financialDocuments)
        .values({ source: "manual", amountCents: 1, companyId: w.aId, contractId: w.contractId }),
  ],
  [
    "financial_documents_quote_company_fk",
    () =>
      db
        .insert(s.financialDocuments)
        .values({ source: "manual", amountCents: 1, companyId: w.aId, quoteId: w.quoteId }),
  ],
  [
    "financial_documents_schedule_company_fk",
    () =>
      db.insert(s.financialDocuments).values({
        source: "manual",
        amountCents: 1,
        companyId: w.aId,
        scheduleItemId: w.scheduleItemId,
      }),
  ],
  [
    "financial_documents_document_company_fk",
    () =>
      db
        .insert(s.financialDocuments)
        .values({ source: "manual", amountCents: 1, companyId: w.aId, documentId: w.documentId }),
  ],
  [
    "payment_schedule_items_project_company_fk",
    () =>
      db
        .insert(s.paymentScheduleItems)
        .values({ label: "x", amountCents: 1, companyId: w.aId, projectId: w.projectId }),
  ],
  [
    "payment_schedule_items_quote_company_fk",
    () =>
      db
        .insert(s.paymentScheduleItems)
        .values({ label: "x", amountCents: 1, companyId: w.aId, quoteId: w.quoteId }),
  ],
  [
    "payment_schedule_items_contract_company_fk",
    () =>
      db
        .insert(s.paymentScheduleItems)
        .values({ label: "x", amountCents: 1, companyId: w.aId, contractId: w.contractId }),
  ],
  [
    "payment_schedule_items_document_company_fk",
    () =>
      db.insert(s.paymentScheduleItems).values({
        label: "x",
        amountCents: 1,
        companyId: w.aId,
        financialDocumentId: w.financialDocumentId,
      }),
  ],
  [
    "direct_costs_project_company_fk",
    () =>
      db.insert(s.directCosts).values({
        label: "x",
        category: "other",
        amountCents: 1,
        incurredOn: "2026-11-04",
        companyId: w.aId,
        projectId: w.projectId,
      }),
  ],
  [
    "direct_costs_site_company_fk",
    () =>
      db.insert(s.directCosts).values({
        label: "x",
        category: "other",
        amountCents: 1,
        incurredOn: "2026-11-04",
        companyId: w.aId,
        siteId: w.siteId,
      }),
  ],
  [
    "direct_costs_contract_company_fk",
    () =>
      db.insert(s.directCosts).values({
        label: "x",
        category: "other",
        amountCents: 1,
        incurredOn: "2026-11-04",
        companyId: w.aId,
        contractId: w.contractId,
      }),
  ],
  [
    "documents_project_company_fk",
    () => db.insert(s.documents).values({ title: "x", companyId: w.aId, projectId: w.projectId }),
  ],
  [
    "documents_contract_company_fk",
    () => db.insert(s.documents).values({ title: "x", companyId: w.aId, contractId: w.contractId }),
  ],
  [
    "documents_site_company_fk",
    () => db.insert(s.documents).values({ title: "x", companyId: w.aId, siteId: w.siteId }),
  ],
  [
    "documents_ticket_company_fk",
    () => db.insert(s.documents).values({ title: "x", companyId: w.aId, ticketId: w.ticketId }),
  ],
  [
    "documents_quote_company_fk",
    () => db.insert(s.documents).values({ title: "x", companyId: w.aId, quoteId: w.quoteId }),
  ],
  [
    "conversations_project_company_fk",
    () => db.insert(s.conversations).values({ companyId: w.aId, projectId: w.projectId }),
  ],
  [
    "conversations_contact_company_fk",
    () => db.insert(s.conversations).values({ companyId: w.aId, contactId: w.contactId }),
  ],
  [
    "messages_conversation_company_fk",
    () =>
      db.insert(s.messages).values({
        companyId: w.aId,
        conversationId: w.conversationId,
        direction: "inbound",
        body: "x",
      }),
  ],
  [
    "comments_document_company_fk",
    () =>
      db.insert(s.comments).values({
        companyId: w.aId,
        entityType: "project",
        entityId: w.projectId,
        body: "x",
        documentId: w.documentId,
      }),
  ],
  [
    "appointments_contact_company_fk",
    () =>
      db.insert(s.appointments).values({
        title: "x",
        startsAt: new Date(),
        companyId: w.aId,
        contactId: w.contactId,
      }),
  ],
  [
    "appointments_project_company_fk",
    () =>
      db.insert(s.appointments).values({
        title: "x",
        startsAt: new Date(),
        companyId: w.aId,
        projectId: w.projectId,
      }),
  ],
  [
    "appointments_opportunity_company_fk",
    () =>
      db.insert(s.appointments).values({
        title: "x",
        startsAt: new Date(),
        companyId: w.aId,
        opportunityId: w.opportunityId,
      }),
  ],
  [
    "portal_memberships_contact_company_fk",
    () =>
      db
        .insert(s.portalMemberships)
        .values({ userId: w.userId, companyId: w.aId, contactId: w.contactId }),
  ],
];

describe("liens entre clients", () => {
  it.each(CROSS_COMPANY_LINKS)(
    "%s refuse un objet d'un autre client",
    async (constraint, attempt) => {
      const error = await attempt().catch((caught: unknown) => caught);
      expect(isForeignKeyViolation(error, constraint)).toBe(true);
    },
  );

  it("couvre toutes les clés composites vers un client", async () => {
    const result = await client.query<{ conname: string }>(
      `select conname from pg_constraint
        where contype = 'f' and connamespace = 'public'::regnamespace
          and conname like '%\\_company\\_fk'`,
    );
    const tested = new Set(CROSS_COMPANY_LINKS.map(([constraint]) => constraint));
    // Testées séparément : mêmes mécanismes, plusieurs lignes parentes à préparer.
    const covered = new Set([
      "contract_sites_site_company_fk",
      "maintenance_interventions_site_company_fk",
      "maintenance_interventions_ticket_company_fk",
      "messages_author_contact_company_fk",
      "messages_document_company_fk",
    ]);
    const missing = result.rows
      .map((row) => row.conname)
      .filter((name) => !tested.has(name) && !covered.has(name));
    expect(missing).toEqual([]);
  });

  it("refuse une pièce jointe ou un auteur d'un autre client, conversation valide", async () => {
    const conversation = await createConversation(db, { companyId: w.aId });
    const base = {
      companyId: w.aId,
      conversationId: conversation.id,
      direction: "inbound" as const,
      body: "x",
    };
    expect(
      isForeignKeyViolation(
        await db
          .insert(s.messages)
          .values({ ...base, documentId: w.documentId })
          .catch((caught: unknown) => caught),
        "messages_document_company_fk",
      ),
    ).toBe(true);
    expect(
      isForeignKeyViolation(
        await db
          .insert(s.messages)
          .values({ ...base, authorContactId: w.contactId })
          .catch((caught: unknown) => caught),
        "messages_author_contact_company_fk",
      ),
    ).toBe(true);
  });

  it("refuse le site ou le ticket d'un autre client, contrat valide", async () => {
    const contract = await createContract(db, { companyId: w.aId });
    const base = { companyId: w.aId, contractId: contract.id, title: "x" };
    expect(
      isForeignKeyViolation(
        await db
          .insert(s.maintenanceInterventions)
          .values({ ...base, siteId: w.siteId })
          .catch((caught: unknown) => caught),
        "maintenance_interventions_site_company_fk",
      ),
    ).toBe(true);
    expect(
      isForeignKeyViolation(
        await db
          .insert(s.maintenanceInterventions)
          .values({ ...base, ticketId: w.ticketId })
          .catch((caught: unknown) => caught),
        "maintenance_interventions_ticket_company_fk",
      ),
    ).toBe(true);
    expect(
      isForeignKeyViolation(
        await db
          .insert(s.contractSites)
          .values({ contractId: contract.id, siteId: w.siteId, companyId: w.aId })
          .catch((caught: unknown) => caught),
        "contract_sites_site_company_fk",
      ),
    ).toBe(true);
  });

  it("accepte les mêmes liens au sein d'un client", async () => {
    const companyId = w.bId;
    await db.insert(s.tickets).values({
      number: "ok-1",
      subject: "x",
      channel: "email",
      category: "bug",
      companyId,
      siteId: w.siteId,
      contractId: w.contractId,
      projectId: w.projectId,
      changeRequestId: w.changeRequestId,
    });
    await db.insert(s.contractSites).values({
      contractId: w.contractId,
      siteId: w.siteId,
      companyId,
    });
    await db.insert(s.timeEntries).values({
      memberId: w.memberId,
      companyId,
      projectId: w.projectId,
      taskId: w.taskId,
      ticketId: w.ticketId,
      contractId: w.contractId,
      workOn: "2026-11-04",
      minutes: 30,
      category: "production",
    });
  });
});

describe("une colonne company_id vide ne contourne pas le cloisonnement", () => {
  it.each([
    [
      "time_entries_company_required_check",
      () =>
        db.insert(s.timeEntries).values({
          memberId: w.memberId,
          projectId: w.projectId,
          workOn: "2026-11-04",
          minutes: 30,
          // Prospection : l'autre contrainte (rattachement) ne se déclenche pas avant celle-ci.
          category: "prospecting",
        }),
    ],
    [
      "missions_company_required_check",
      () =>
        db.insert(s.missions).values({ title: "x", memberId: w.memberId, projectId: w.projectId }),
    ],
    [
      "direct_costs_company_required_check",
      () =>
        db.insert(s.directCosts).values({
          label: "x",
          category: "other",
          amountCents: 1,
          incurredOn: "2026-11-04",
          projectId: w.projectId,
        }),
    ],
    [
      "documents_company_required_check",
      () => db.insert(s.documents).values({ title: "x", projectId: w.projectId }),
    ],
    [
      "documents_client_visibility_check",
      () => db.insert(s.documents).values({ title: "x", visibility: "client" }),
    ],
    [
      "appointments_company_required_check",
      () =>
        db
          .insert(s.appointments)
          .values({ title: "x", startsAt: new Date(), projectId: w.projectId }),
    ],
  ] as const)("%s", async (constraint, attempt) => {
    await expect(attempt()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining(constraint) }),
    });
  });
});

describe("liens internes à un projet, un site, un devis, un document", () => {
  it("refuse une tâche attachée à la phase d'un autre projet", async () => {
    const other = await createProject(db, { companyId: w.bId });
    const error = await db
      .insert(s.tasks)
      .values({ number: "x", title: "x", projectId: other.id, phaseId: w.phaseId })
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(error, "tasks_phase_project_fk")).toBe(true);
  });

  it("refuse une sous-tâche d'un autre projet", async () => {
    const other = await createProject(db, { companyId: w.bId });
    const error = await db
      .insert(s.tasks)
      .values({ number: "x", title: "x", projectId: other.id, parentTaskId: w.taskId })
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(error, "tasks_parent_project_fk")).toBe(true);
  });

  it("refuse le temps d'une tâche sur un autre projet, même client", async () => {
    const other = await createProject(db, { companyId: w.bId });
    const error = await db
      .insert(s.timeEntries)
      .values({
        memberId: w.memberId,
        companyId: w.bId,
        projectId: other.id,
        taskId: w.taskId,
        workOn: "2026-11-04",
        minutes: 30,
        category: "production",
      })
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(error, "time_entries_task_project_fk")).toBe(true);
  });

  it("refuse un livrable dont le document appartient à un autre projet", async () => {
    const other = await createProject(db, { companyId: w.bId });
    const error = await db
      .insert(s.deliverables)
      .values({ title: "x", projectId: other.id, documentId: w.documentId })
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(error, "deliverables_document_project_fk")).toBe(true);
  });

  it("refuse la sauvegarde d'un site sur l'environnement d'un autre", async () => {
    const siteA = await createSite(db, { companyId: w.bId });
    const siteB = await createSite(db, { companyId: w.bId });
    const [environment] = await db
      .insert(s.siteEnvironments)
      .values({ siteId: siteA.id, kind: "production" })
      .returning();
    const error = await db
      .insert(s.siteBackups)
      .values({ siteId: siteB.id, environmentId: environment?.id })
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(error, "site_backups_environment_site_fk")).toBe(true);
  });

  it("refuse la version courante d'un autre devis ou d'un autre document", async () => {
    const { quote } = await createQuote(db, { companyId: w.bId });
    const quoteError = await db
      .update(s.quotes)
      .set({ currentVersionId: w.versionId })
      .where(eq(s.quotes.id, quote.id))
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(quoteError, "quotes_current_version_fk")).toBe(true);

    const first = await createDocument(db);
    const second = await createDocument(db);
    const documentError = await db
      .update(s.documents)
      .set({ currentVersionId: second.version.id })
      .where(eq(s.documents.id, first.document.id))
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(documentError, "documents_current_version_fk")).toBe(true);
  });
});

describe("aucune perte d'historique", () => {
  it("refuse de supprimer un objet référencé", async () => {
    const error = await db
      .delete(s.companies)
      .where(eq(s.companies.id, w.bId))
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(error)).toBe(true);
  });

  it("autorise une fusion en une seule instruction, parents et enfants ensemble", async () => {
    const winner = await createCompany(db);
    const loser = await createCompany(db);
    const contact = await createContact(db, { companyId: loser.id });
    const opportunity = await createOpportunity(db, {
      companyId: loser.id,
      contactId: contact.id,
    });

    // Bloqué pièce par pièce : la clé composite refuse de déplacer le parent seul.
    const stepByStep = await db
      .update(s.contacts)
      .set({ companyId: winner.id })
      .where(eq(s.contacts.companyId, loser.id))
      .catch((caught: unknown) => caught);
    expect(isForeignKeyViolation(stepByStep, "opportunities_contact_company_fk")).toBe(true);

    await db.execute(sql`
      with moved_contacts as (
        update contacts set company_id = ${winner.id} where company_id = ${loser.id}
      )
      update opportunities set company_id = ${winner.id} where company_id = ${loser.id}
    `);
    const [moved] = await db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, opportunity.id));
    expect(moved?.companyId).toBe(winner.id);
  });
});

describe("unicités partielles", () => {
  it("n'autorise qu'un projet par devis accepté", async () => {
    const { quote } = await createQuote(db, { companyId: w.bId });
    await createProject(db, { companyId: w.bId, quoteId: quote.id });
    const error = await createProject(db, { companyId: w.bId, quoteId: quote.id }).catch(
      (caught: unknown) => caught,
    );
    expect(isUniqueViolation(error, "projects_quote_id_unique")).toBe(true);
    // Sans devis, plusieurs projets restent possibles.
    await createProject(db, { companyId: w.bId });
    await createProject(db, { companyId: w.bId });
  });

  it("n'autorise qu'un SIREN actif, et le libère à la fusion", async () => {
    const first = await createCompany(db, { siren: "111111111" });
    const error = await createCompany(db, { siren: "111111111" }).catch(
      (caught: unknown) => caught,
    );
    expect(isUniqueViolation(error, "companies_siren_unique")).toBe(true);
    const winner = await createCompany(db);
    await db
      .update(s.companies)
      .set({ mergedIntoId: winner.id })
      .where(eq(s.companies.id, first.id));
    await createCompany(db, { siren: "111111111" });
    // Sans SIREN : aucune contrainte.
    await createCompany(db);
    await createCompany(db);
  });

  it("n'autorise qu'un incident ouvert par site, puis un nouveau après clôture", async () => {
    const site = await createSite(db, { companyId: w.bId });
    const incident = { companyId: w.bId, siteId: site.id, isIncident: true, category: "incident" };
    const first = await createTicket(db, incident as Parameters<typeof createTicket>[1]);
    const error = await createTicket(db, incident as Parameters<typeof createTicket>[1]).catch(
      (caught: unknown) => caught,
    );
    expect(isUniqueViolation(error, "tickets_open_incident_unique")).toBe(true);
    await db.update(s.tickets).set({ status: "resolved" }).where(eq(s.tickets.id, first.id));
    await createTicket(db, incident as Parameters<typeof createTicket>[1]);
    // Un ticket ordinaire sur le même site reste possible.
    await createTicket(db, { companyId: w.bId, siteId: site.id });
  });

  it("n'autorise qu'un accès actif par contact", async () => {
    const portal = await createPortalClient(db);
    const error = await createPortalClient(db, {
      company: portal.company,
      contact: portal.contact,
    }).catch((caught: unknown) => caught);
    expect(isUniqueViolation(error, "portal_memberships_contact_unique")).toBe(true);
    await db
      .update(s.portalMemberships)
      .set({ status: "revoked" })
      .where(eq(s.portalMemberships.id, portal.membership.id));
    await createPortalClient(db, { company: portal.company, contact: portal.contact });
  });

  it("déduplique une facture par (source, référence)", async () => {
    const values = { companyId: w.bId, source: "indy_csv" as const, amountCents: 1 };
    await db.insert(s.financialDocuments).values({ ...values, externalRef: "F-1" });
    const error = await db
      .insert(s.financialDocuments)
      .values({ ...values, externalRef: "F-1" })
      .catch((caught: unknown) => caught);
    expect(isUniqueViolation(error, "financial_documents_source_ref_unique")).toBe(true);
    // Sans référence : deux saisies distinctes restent possibles.
    await db.insert(s.financialDocuments).values(values);
    await db.insert(s.financialDocuments).values(values);
  });
});

describe("contraintes de valeur", () => {
  it("refuse un statut inconnu et un rôle de contact inconnu", async () => {
    await expect(
      client.query("update projects set status = 'inconnu' where id = $1", [w.projectId]),
    ).rejects.toThrow(/projects_status_check/);
    await expect(
      client.query("update contacts set roles = array['chef']::text[] where id = $1", [
        w.contactId,
      ]),
    ).rejects.toThrow(/contacts_roles_check/);
  });

  it("exige un rattachement pour le temps, sauf prospection et administratif", async () => {
    const base = { memberId: w.memberId, workOn: "2026-11-04", minutes: 30 };
    await expect(
      db.insert(s.timeEntries).values({ ...base, category: "production" }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("time_entries_attachment_check"),
      }),
    });
    await db.insert(s.timeEntries).values({ ...base, category: "prospecting" });
    await db.insert(s.timeEntries).values({ ...base, category: "admin" });
  });

  it("refuse une dépendance d'une tâche sur elle-même", async () => {
    await expect(
      db.insert(s.taskDependencies).values({ taskId: w.taskId, dependsOnTaskId: w.taskId }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("task_dependencies_not_self_check"),
      }),
    });
  });
});

describe("recherche", () => {
  it("trouve une entreprise par préfixe avec l'expression de l'index", async () => {
    await createCompany(db, { name: "Atelier Lune Fleuriste" });
    const rows = await db
      .select({ name: s.companies.name })
      .from(s.companies)
      .where(
        sql`to_tsvector('simple', ${s.companies.name}) @@ to_tsquery('simple', ${prefixTsQuery("atel lun")})`,
      );
    expect(rows.map((row) => row.name)).toEqual(["Atelier Lune Fleuriste"]);
  });
});
