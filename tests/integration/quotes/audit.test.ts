import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCatalogItem,
  getCatalogItem,
  listActiveCatalogItems,
  listCatalogItems,
  setCatalogItemActive,
  updateCatalogItem,
} from "@/modules/catalog/catalog.service";
import {
  acceptQuoteManually,
  getSignedDocumentUrl,
  getSignerOptions,
  markQuoteSentManually,
  processDocusealWebhook,
  refreshQuoteSignature,
  sendQuoteForSignature,
} from "@/modules/quotes/quote-signature.service";
import { followUpDays, quoteRowHref } from "@/modules/quotes/quote.rules";
import {
  archiveQuote,
  createAmendment,
  createQuote,
  expireOverdueQuotes,
  expireQuote,
  getAmendmentOptions,
  getOpportunityOptions,
  getQuoteDetail,
  getQuoteDocument,
  getQuoteEditor,
  getQuoteFormOptions,
  getQuoteSummary,
  listQuotes,
  listQuotesForCompany,
  markQuoteNegotiation,
  refuseQuote,
  saveQuoteContent,
  updateQuoteReferences,
} from "@/modules/quotes/quote.service";
import {
  auditLog,
  changeRequests,
  domainEvents,
  opportunities,
  projects,
  quotes,
  quoteVersions,
} from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
} from "@/server/errors";
import { createTestDatabase } from "../../helpers/db";
import { createCompany, createContact } from "../../helpers/factories";
import {
  content,
  createCrmOpportunity,
  createFixture,
  DocusealStub,
  UNCONFIGURED_DEPS,
  type Fixture,
} from "./helpers";

const DAY = 86_400_000;
const ACCEPTANCE = { indyReference: "INDY-1", signedOn: "2026-01-15" };
const CATALOG_ITEM = {
  kind: "project",
  activity: "vitrine",
  name: "Vitrine auditée",
  priceCents: 650_000,
  estimatedCostCents: 240_000,
  estimatedMinutes: 5040,
};

/** Défauts prouvés par l'audit du lot : chaque test échouait avant sa correction. */
describe("audit des devis", () => {
  let close: () => Promise<void>;
  let fixture: Fixture;
  const stub = new DocusealStub();
  const deps = UNCONFIGURED_DEPS;

  beforeAll(async () => {
    const database = await createTestDatabase();
    close = database.close;
    fixture = await createFixture(database.db);
    await stub.start();
  });
  afterAll(async () => {
    await stub.stop();
    await close();
  });

  async function sentQuote(options: { companyId?: string; opportunityId?: string } = {}) {
    const companyId = options.companyId ?? (await createCompany(fixture.db)).id;
    const quote = await createQuote(fixture.member, {
      companyId,
      opportunityId: options.opportunityId,
      title: "Site vitrine",
    });
    await saveQuoteContent(fixture.member, quote.id, content(), deps);
    return markQuoteSentManually(fixture.member, quote.id);
  }

  async function sentWithSignature(options: { opportunityId?: string; companyId?: string } = {}) {
    const companyId = options.companyId ?? (await createCompany(fixture.db)).id;
    const contact = await createContact(fixture.db, {
      companyId,
      email: `audit-${Math.random().toString(36).slice(2)}@test.local`,
    });
    const quote = await createQuote(fixture.member, {
      companyId,
      opportunityId: options.opportunityId,
      title: "Site vitrine",
    });
    await saveQuoteContent(fixture.member, quote.id, content(), stub.deps());
    return sendQuoteForSignature(
      fixture.member,
      quote.id,
      { signerContactId: contact.id },
      stub.deps(),
    );
  }

  function completed(submissionId: string | null) {
    return {
      type: "submission.completed" as const,
      receiptId: `submission.completed:${submissionId}`,
      submissionId: String(submissionId),
      externalIds: [],
      completedAt: new Date("2026-11-02T10:00:00Z"),
    };
  }

  describe("rattachement à une affaire", () => {
    it("refuse par identifiant une affaire close ou archivée", async () => {
      for (const change of [
        { stage: "WON" as const },
        { stage: "LOST" as const },
        { archivedAt: new Date() },
      ]) {
        const { opportunity, companyId } = await createCrmOpportunity(fixture);
        await fixture.db
          .update(opportunities)
          .set(change)
          .where(eq(opportunities.id, opportunity.id));
        await expect(
          createQuote(fixture.member, {
            companyId,
            opportunityId: opportunity.id,
            title: "Par identifiant",
          }),
        ).rejects.toBeInstanceOf(ConflictError);
      }
    });

    it("ne crée pas de second projet quand deux devis de la même affaire sont acceptés", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const first = await sentQuote({ companyId, opportunityId: opportunity.id });
      const rival = await sentQuote({ companyId, opportunityId: opportunity.id });

      await acceptQuoteManually(fixture.member, first.id, ACCEPTANCE, deps);
      await expect(
        acceptQuoteManually(fixture.member, rival.id, ACCEPTANCE, deps),
      ).rejects.toBeInstanceOf(ConflictError);

      const created = await fixture.db
        .select()
        .from(projects)
        .where(eq(projects.opportunityId, opportunity.id));
      expect(created).toHaveLength(1);
      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, rival.id));
      expect(row?.status).toBe("sent");
    });

    it("trace la signature DocuSeal d'un devis concurrent sans la rejouer indéfiniment", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const first = await sentQuote({ companyId, opportunityId: opportunity.id });
      const rival = await sentWithSignature({ companyId, opportunityId: opportunity.id });
      await acceptQuoteManually(fixture.member, first.id, ACCEPTANCE, deps);

      const outcome = await processDocusealWebhook(
        { db: fixture.db, crm: fixture.crm },
        completed(rival.docusealSubmissionId),
      );
      expect(outcome).toBe("ignored");
      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, rival.id));
      expect(row?.status).toBe("sent");
      const traces = await fixture.db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.entityId, rival.id), eq(auditLog.action, "quote.signature_ignored")),
        );
      expect(traces).toHaveLength(1);
      expect(traces[0]?.metadata).toMatchObject({ reason: "other_quote_accepted" });
    });

    it("accepte un avenant même si le devis d'origine de l'affaire est déjà accepté", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const parent = await sentQuote({ companyId, opportunityId: opportunity.id });
      await acceptQuoteManually(fixture.member, parent.id, ACCEPTANCE, deps);
      const amendment = await createAmendment(fixture.member, parent.id, { title: "Page" });
      await saveQuoteContent(fixture.member, amendment.id, content(), deps);
      await markQuoteSentManually(fixture.member, amendment.id);
      const result = await acceptQuoteManually(fixture.member, amendment.id, ACCEPTANCE, deps);
      expect(result.quote.status).toBe("accepted");
      expect(result.projectId).toBeNull();
    });
  });

  describe("expiration", () => {
    it("rend caduque la demande de signature en attente d'un devis expiré", async () => {
      const quote = await sentWithSignature();
      expect(quote.signatureStatus).toBe("pending");
      const expired = await expireQuote(fixture.member, quote.id, new Date(Date.now() + 40 * DAY));
      expect(expired).toMatchObject({
        status: "expired",
        signatureStatus: "none",
        docusealSubmissionId: null,
      });

      const overdue = await sentWithSignature();
      await expireOverdueQuotes(fixture.db, new Date(Date.now() + 40 * DAY));
      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, overdue.id));
      expect(row).toMatchObject({
        status: "expired",
        signatureStatus: "none",
        docusealSubmissionId: null,
      });
    });
  });

  describe("coûts internes", () => {
    it("les masque au rôle Lecture, dans le service, et les garde pour qui compose le devis", async () => {
      const quote = await sentQuote();

      const hidden = await getQuoteDetail(fixture.viewer, quote.id);
      expect(hidden.costsVisible).toBe(false);
      expect(hidden.version.estimatedCostCents).toBe(0);
      expect(hidden.currentVersion.estimatedCostCents).toBe(0);
      expect(hidden.versions.every((version) => version.estimatedCostCents === 0)).toBe(true);
      expect(hidden.latestSentVersion?.estimatedCostCents).toBe(0);
      expect(hidden.lines.every((line) => line.estimatedCostCents === 0)).toBe(true);
      expect(hidden.amounts.marginPercent).toBeNull();
      // Le prix reste lisible : seul le coût est masqué.
      expect(hidden.amounts.totalCents).toBe(780_000);

      for (const ctx of [fixture.member, fixture.admin]) {
        const seen = await getQuoteDetail(ctx, quote.id);
        expect(seen.costsVisible).toBe(true);
        expect(seen.version.estimatedCostCents).toBe(288_000);
        expect(seen.lines[0]?.estimatedCostCents).toBe(288_000);
        expect(seen.amounts.marginPercent).not.toBeNull();
      }
    });

    it("les masque aussi dans le catalogue", async () => {
      const item = await createCatalogItem(fixture.admin, CATALOG_ITEM);
      const hidden = await getCatalogItem(fixture.viewer, item.id);
      expect(hidden.estimatedCostCents).toBe(0);
      expect(hidden.priceCents).toBe(650_000);
      const page = await listCatalogItems(fixture.viewer, { search: "Vitrine auditée" });
      expect(page.items[0]?.estimatedCostCents).toBe(0);

      expect((await getCatalogItem(fixture.member, item.id)).estimatedCostCents).toBe(240_000);
      const seen = await listCatalogItems(fixture.admin, { search: "Vitrine auditée" });
      expect(seen.items[0]?.estimatedCostCents).toBe(240_000);
    });
  });

  describe("entrées mal formées", () => {
    it("ne casse pas la liste sur une recherche trop longue", async () => {
      const search = "a".repeat(300);
      await expect(listQuotes(fixture.admin, { search })).resolves.toMatchObject({ total: 0 });
      await expect(listCatalogItems(fixture.admin, { search })).resolves.toMatchObject({
        total: 0,
      });
    });

    it("répond vide, sans erreur SQL, à un identifiant de client mal formé", async () => {
      await expect(listQuotesForCompany(fixture.viewer, "pas-un-uuid")).resolves.toEqual([]);
      await expect(getOpportunityOptions(fixture.member, "pas-un-uuid")).resolves.toEqual([]);
    });

    it("borne la lecture de la fiche client", async () => {
      const companyId = (await createCompany(fixture.db)).id;
      await createQuote(fixture.member, { companyId, title: "A" });
      await createQuote(fixture.member, { companyId, title: "B" });
      await expect(
        listQuotesForCompany(fixture.viewer, companyId, { limit: 1 }),
      ).resolves.toHaveLength(1);
      await expect(
        listQuotesForCompany(fixture.viewer, companyId, { limit: -5 }),
      ).resolves.toHaveLength(1);
      await expect(
        listQuotesForCompany(fixture.viewer, companyId, { limit: 1_000_000 }),
      ).resolves.toHaveLength(2);
    });
  });

  describe("document signé chez DocuSeal", () => {
    it("rend une adresse fraîche du document signé, relue à la demande", async () => {
      const quote = await sentWithSignature();
      await expect(
        getSignedDocumentUrl(fixture.viewer, quote.id, stub.deps()),
      ).rejects.toBeInstanceOf(ConflictError);

      await processDocusealWebhook(
        { db: fixture.db, crm: fixture.crm },
        completed(quote.docusealSubmissionId),
      );
      const url = await getSignedDocumentUrl(fixture.viewer, quote.id, stub.deps());
      expect(url).toBe("https://docuseal.test/file/signe.pdf?expires=1");
      expect(stub.requests.at(-1)).toMatchObject({
        method: "GET",
        path: `/submissions/${quote.docusealSubmissionId}/documents?merge=true`,
      });
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.hasSignedDocument).toBe(true);
    });

    it("dit la connexion requise, la panne et l'absence de document", async () => {
      const quote = await sentWithSignature();
      await processDocusealWebhook(
        { db: fixture.db, crm: fixture.crm },
        completed(quote.docusealSubmissionId),
      );
      await expect(
        getSignedDocumentUrl(fixture.member, quote.id, UNCONFIGURED_DEPS),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);

      stub.failWith = 503;
      await expect(
        getSignedDocumentUrl(fixture.member, quote.id, stub.deps()),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);

      stub.signedDocuments = [];
      await expect(
        getSignedDocumentUrl(fixture.member, quote.id, stub.deps()),
      ).rejects.toBeInstanceOf(ConflictError);
      stub.signedDocuments = [{ name: "Devis signé", url: "https://docuseal.test/x.pdf" }];

      await expect(
        getSignedDocumentUrl(fixture.member, "00000000-0000-4000-8000-000000000000", stub.deps()),
      ).rejects.toBeInstanceOf(NotFoundError);

      await expect(
        getSignedDocumentUrl(fixture.contractor, quote.id, stub.deps()),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("ne désigne plus de document DocuSeal après une acceptation manuelle", async () => {
      const quote = await sentWithSignature();
      const { quote: accepted } = await acceptQuoteManually(
        fixture.member,
        quote.id,
        ACCEPTANCE,
        stub.deps(),
      );
      expect(accepted.docusealSubmissionId).toBeNull();
      const detail = await getQuoteDetail(fixture.member, quote.id);
      expect(detail.hasSignedDocument).toBe(false);
      await expect(
        getSignedDocumentUrl(fixture.member, quote.id, stub.deps()),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("liens", () => {
    it("n'emporte pas la version ni la fenêtre de création d'un devis à l'autre", () => {
      expect(
        quoteRowHref("abc", {
          version: "2",
          nouveau: "1",
          client: "x",
          affaire: "y",
          document: "indisponible",
          q: "lune",
          statut: "signes",
          page: "2",
        }),
      ).toBe("/devis/abc?q=lune&statut=signes&page=2");
    });

    it("ne propose pas un projet archivé", async () => {
      const quote = await sentQuote();
      const { projectId } = await acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps);
      expect((await getQuoteDetail(fixture.viewer, quote.id)).project?.id).toBe(projectId);
      await fixture.db
        .update(projects)
        .set({ archivedAt: new Date() })
        .where(eq(projects.id, String(projectId)));
      expect((await getQuoteDetail(fixture.viewer, quote.id)).project).toBeNull();
    });

    it("refuse d'archiver un devis issu d'une demande de changement", async () => {
      const parent = await sentQuote();
      await acceptQuoteManually(fixture.member, parent.id, ACCEPTANCE, deps);
      const [request] = await fixture.db
        .insert(changeRequests)
        .values({ companyId: parent.companyId, title: "Page en plus", status: "accepted" })
        .returning();
      const amendment = await createAmendment(fixture.member, parent.id, {
        title: "Page en plus",
        changeRequestId: request?.id,
      });
      await expect(archiveQuote(fixture.member, amendment.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });

  describe("règles que les tests existants laissaient passer", () => {
    it("refuse un avenant à un avenant, même accepté", async () => {
      const parent = await sentQuote();
      await acceptQuoteManually(fixture.member, parent.id, ACCEPTANCE, deps);
      const amendment = await createAmendment(fixture.member, parent.id, { title: "Page" });
      await saveQuoteContent(fixture.member, amendment.id, content(), deps);
      await markQuoteSentManually(fixture.member, amendment.id);
      await acceptQuoteManually(fixture.member, amendment.id, ACCEPTANCE, deps);
      await expect(
        createAmendment(fixture.member, amendment.id, { title: "Encore" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("journalise le refus une seule fois, avec son motif et son événement", async () => {
      const quote = await sentQuote();
      await refuseQuote(fixture.member, quote.id, { reason: "Budget" }, deps);
      await refuseQuote(fixture.member, quote.id, { reason: "Budget" }, deps);

      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, quote.id), eq(auditLog.action, "quote.refused")));
      expect(audit).toHaveLength(1);
      expect(audit[0]?.metadata).toMatchObject({ reason: "Budget" });
      const events = await fixture.db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.entityId, quote.id), eq(domainEvents.type, "quote.refused")));
      expect(events).toHaveLength(1);
    });

    it("journalise les références du document officiel, sans écriture si rien ne change", async () => {
      const quote = await sentQuote();
      const references = { indyReference: "INDY-9", officialDocumentUrl: "https://indy.test/9" };
      await updateQuoteReferences(fixture.member, quote.id, references);
      await updateQuoteReferences(fixture.member, quote.id, references);

      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, quote.id), eq(auditLog.action, "quote.updated")));
      const logged = audit.filter((row) => row.metadata.indyReference === "INDY-9");
      expect(logged).toHaveLength(1);
      expect(logged[0]?.metadata.officialDocumentUrl).toBe("https://indy.test/9");
    });

    it("refuse d'envoyer un devis vide ou à 0 €, et ne le fait pas passer en envoyé", async () => {
      const company = await createCompany(fixture.db);
      const empty = await createQuote(fixture.member, { companyId: company.id, title: "Vide" });
      await saveQuoteContent(fixture.member, empty.id, content({ lines: [] }), deps);
      await expect(markQuoteSentManually(fixture.member, empty.id)).rejects.toBeInstanceOf(
        ConflictError,
      );

      const free = await createQuote(fixture.member, { companyId: company.id, title: "Gratuit" });
      await saveQuoteContent(
        fixture.member,
        free.id,
        content({
          lines: [{ label: "Offert", quantity: 1, unitPriceCents: 0, estimatedCostCents: 0 }],
        }),
        deps,
      ).catch(() => undefined);
      await expect(markQuoteSentManually(fixture.member, free.id)).rejects.toBeInstanceOf(
        ConflictError,
      );

      const rows = await fixture.db.select().from(quotes).where(eq(quotes.companyId, company.id));
      expect(rows.every((row) => row.status === "draft")).toBe(true);
    });

    it("n'affiche « Relance J+n » que sur un devis envoyé, à partir de 3 jours", () => {
      const now = new Date("2026-11-10T12:00:00Z");
      const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
      expect(followUpDays("sent", daysAgo(2), now)).toBeNull();
      expect(followUpDays("sent", daysAgo(3), now)).toBe(3);
      expect(followUpDays("sent", daysAgo(9), now)).toBe(9);
      expect(followUpDays("negotiation", daysAgo(9), now)).toBeNull();
      expect(followUpDays("accepted", daysAgo(9), now)).toBeNull();
      expect(followUpDays("sent", null, now)).toBeNull();
    });
  });

  describe("matrice complète par rôle", () => {
    const uuid = "00000000-0000-4000-8000-000000000000";

    it("refuse chaque lecture et chaque écriture aux rôles sans droit", async () => {
      const quote = await sentQuote();
      const { companyId, id } = quote;
      const item = await createCatalogItem(fixture.admin, CATALOG_ITEM);
      const docuseal = stub.deps();

      const reads = (ctx: Fixture["admin"]) => [
        () => listQuotes(ctx),
        () => getQuoteSummary(ctx),
        () => listQuotesForCompany(ctx, companyId),
        () => getQuoteDetail(ctx, id),
        () => getQuoteDocument(ctx, id),
        () => getSignedDocumentUrl(ctx, id, docuseal),
        () => listCatalogItems(ctx),
        () => getCatalogItem(ctx, item.id),
        () => listActiveCatalogItems(ctx),
      ];
      const writes = (ctx: Fixture["admin"]) => [
        () => getQuoteFormOptions(ctx),
        () => getOpportunityOptions(ctx, companyId),
        () => getAmendmentOptions(ctx, companyId),
        () => getQuoteEditor(ctx, id),
        () => getSignerOptions(ctx, id),
        () => createQuote(ctx, { companyId, title: "x" }),
        () => createAmendment(ctx, id, { title: "x" }),
        () => saveQuoteContent(ctx, id, content(), deps),
        () => updateQuoteReferences(ctx, id, { indyReference: "x" }),
        () => markQuoteNegotiation(ctx, id),
        () => refuseQuote(ctx, id, { reason: "x" }, deps),
        () => expireQuote(ctx, id),
        () => archiveQuote(ctx, id),
        () => markQuoteSentManually(ctx, id),
        () => sendQuoteForSignature(ctx, id, { signerContactId: uuid }, docuseal),
        () => refreshQuoteSignature(ctx, id, docuseal),
        () => acceptQuoteManually(ctx, id, ACCEPTANCE, deps),
      ];
      const manage = (ctx: Fixture["admin"]) => [
        () => createCatalogItem(ctx, CATALOG_ITEM),
        () => updateCatalogItem(ctx, item.id, CATALOG_ITEM),
        () => setCatalogItemActive(ctx, item.id, false),
      ];

      for (const ctx of [fixture.contractor, fixture.client]) {
        for (const attempt of [...reads(ctx), ...writes(ctx), ...manage(ctx)]) {
          await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
      for (const attempt of [...writes(fixture.viewer), ...manage(fixture.viewer)]) {
        await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
      }
      for (const attempt of manage(fixture.member)) {
        await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
      }

      // Rien n'a bougé malgré ces tentatives.
      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, id));
      expect(row?.status).toBe("sent");
      const versions = await fixture.db
        .select()
        .from(quoteVersions)
        .where(eq(quoteVersions.quoteId, id));
      expect(versions).toHaveLength(1);
    });
  });
});
