import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCatalogItem,
  setCatalogItemActive,
  updateCatalogItem,
} from "@/modules/catalog/catalog.service";
import {
  acceptQuoteManually,
  markQuoteSentManually,
} from "@/modules/quotes/quote-signature.service";
import {
  archiveQuote,
  createAmendment,
  getAmendmentOptions,
  createQuote,
  expireOverdueQuotes,
  expireQuote,
  getQuoteDetail,
  getQuoteDocument,
  getQuoteEditor,
  getQuoteSummary,
  listQuotes,
  listQuotesDueForReminder,
  listQuotesForCompany,
  markQuoteNegotiation,
  recordQuoteReminder,
  refuseQuote,
  saveQuoteContent,
  updateQuoteReferences,
} from "@/modules/quotes/quote.service";
import {
  canQuoteTransition,
  QUOTE_STATUSES,
  type QuoteStatus,
} from "@/modules/quotes/quote.status";
import { computeAmounts, computeTotals } from "@/modules/quotes/quote.calc";
import { startOfMonthInParis, todayInParis } from "@/modules/quotes/quote.rules";
import {
  auditLog,
  changeRequests,
  domainEvents,
  opportunities,
  projects,
  quoteLines,
  quotes,
  quoteVersions,
} from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  IntegrationError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { createTestDatabase } from "../../helpers/db";
import { createCompany, createTeamMember } from "../../helpers/factories";
import {
  content,
  createCrmOpportunity,
  createFixture,
  LINE,
  UNCONFIGURED_DEPS,
  type Fixture,
} from "./helpers";

const deps = UNCONFIGURED_DEPS;
const DAY = 86_400_000;

describe("devis", () => {
  let close: () => Promise<void>;
  let fixture: Fixture;

  beforeAll(async () => {
    const database = await createTestDatabase();
    close = database.close;
    fixture = await createFixture(database.db);
  });
  afterAll(() => close());

  async function draft(options: { companyId?: string; opportunityId?: string } = {}) {
    const companyId = options.companyId ?? (await createCompany(fixture.db)).id;
    return createQuote(fixture.member, {
      companyId,
      opportunityId: options.opportunityId,
      title: "Site vitrine",
    });
  }

  async function sentQuote(options: { companyId?: string; opportunityId?: string } = {}) {
    const quote = await draft(options);
    await saveQuoteContent(fixture.member, quote.id, content(), deps);
    return markQuoteSentManually(fixture.member, quote.id);
  }

  const ACCEPTANCE = { indyReference: "INDY-42", signedOn: "2026-01-15" };

  describe("machine à états", () => {
    const allowed: Record<QuoteStatus, QuoteStatus[]> = {
      draft: ["sent"],
      sent: ["negotiation", "accepted", "refused", "expired"],
      negotiation: ["accepted", "refused"],
      accepted: [],
      refused: [],
      expired: [],
    };

    it("n'autorise que les transitions du contrat", () => {
      for (const from of QUOTE_STATUSES) {
        for (const to of QUOTE_STATUSES) {
          expect(canQuoteTransition(from, to)).toBe(allowed[from].includes(to));
        }
      }
    });

    it("refuse d'accepter, de refuser ou d'expirer un brouillon", async () => {
      const quote = await draft();
      await saveQuoteContent(fixture.member, quote.id, content(), deps);
      await expect(
        acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        refuseQuote(fixture.member, quote.id, { reason: "Budget" }, deps),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(expireQuote(fixture.member, quote.id)).rejects.toBeInstanceOf(ConflictError);
      await expect(markQuoteNegotiation(fixture.member, quote.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("parcourt envoyé → négociation → refusé, sans issue ensuite", async () => {
      const quote = await sentQuote();
      const negotiating = await markQuoteNegotiation(fixture.member, quote.id);
      expect(negotiating.status).toBe("negotiation");
      // Idempotent.
      await markQuoteNegotiation(fixture.member, quote.id);

      // La négociation n'expire pas : seul un devis envoyé peut le faire.
      await expect(expireQuote(fixture.member, quote.id)).rejects.toBeInstanceOf(ConflictError);

      const refused = await refuseQuote(fixture.member, quote.id, { reason: "Budget" }, deps);
      expect(refused.status).toBe("refused");
      expect(refused.refusedAt).not.toBeNull();

      await refuseQuote(fixture.member, quote.id, { reason: "Budget" }, deps);
      const events = await fixture.db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, "quote.refused"), eq(domainEvents.entityId, quote.id)));
      expect(events).toHaveLength(1);

      await expect(
        acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        saveQuoteContent(fixture.member, quote.id, content(), deps),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("exige un motif de refus", async () => {
      const quote = await sentQuote();
      await expect(
        refuseQuote(fixture.member, quote.id, { reason: " " }, deps),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("création et numérotation", () => {
    it("numérote depuis les compteurs et crée la version 1", async () => {
      const first = await draft();
      const second = await draft();
      const year = Number(todayInParis().slice(0, 4));
      expect(first.number).toMatch(new RegExp(`^D-${year}-\\d{3}$`));
      expect(Number(second.number.slice(-3))).toBe(Number(first.number.slice(-3)) + 1);
      expect(first.status).toBe("draft");

      const detail = await getQuoteDetail(fixture.viewer, first.id);
      expect(detail.version.version).toBe(1);
      expect(detail.actions).toMatchObject({ edit: true, send: true, accept: false });

      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "quote.created"), eq(auditLog.entityId, first.id)));
      expect(audit).toHaveLength(1);
    });

    it("propose « Émis par » d'après les associés, sans rien de figé", async () => {
      await createTeamMember(fixture.db, { kind: "partner", fullName: "Ada Lovelace" });
      await createTeamMember(fixture.db, { kind: "partner", fullName: "Grace Hopper" });
      const quote = await draft();
      expect(quote.issuedByNote).toBe("Émis par Ada Lovelace et Grace Hopper, en co-traitance");
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.invoicesPerPayment).toBe(2);
    });

    it("refuse une affaire d'un autre client et un client inconnu", async () => {
      const { opportunity } = await createCrmOpportunity(fixture);
      const other = await createCompany(fixture.db);
      await expect(
        createQuote(fixture.member, {
          companyId: other.id,
          opportunityId: opportunity.id,
          title: "Croisé",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        createQuote(fixture.member, {
          companyId: "9f2b6a0e-0000-4000-8000-000000000000",
          title: "Sans client",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createQuote(fixture.member, { companyId: "pas-un-uuid", title: "x" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("permissions et périmètre", () => {
    it("applique la matrice par rôle", async () => {
      const quote = await draft();
      const companyId = quote.companyId;

      for (const ctx of [fixture.contractor, fixture.client]) {
        await expect(listQuotes(ctx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(getQuoteDetail(ctx, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(getQuoteDocument(ctx, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(listQuotesForCompany(ctx, companyId)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(getQuoteSummary(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      }

      await expect(listQuotes(fixture.viewer)).resolves.toBeDefined();
      await expect(createQuote(fixture.viewer, { companyId, title: "x" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        saveQuoteContent(fixture.viewer, quote.id, content(), deps),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getQuoteEditor(fixture.viewer, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(markQuoteSentManually(fixture.viewer, quote.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        acceptQuoteManually(fixture.viewer, quote.id, ACCEPTANCE, deps),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(archiveQuote(fixture.viewer, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        updateQuoteReferences(fixture.viewer, quote.id, { indyReference: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("répond 404 pour un objet inconnu, mal formé ou archivé", async () => {
      const unknown = "9f2b6a0e-0000-4000-8000-000000000000";
      await expect(getQuoteDetail(fixture.viewer, unknown)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getQuoteDetail(fixture.viewer, "abc")).rejects.toBeInstanceOf(NotFoundError);

      const quote = await draft();
      await archiveQuote(fixture.member, quote.id);
      await expect(getQuoteDetail(fixture.viewer, quote.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        saveQuoteContent(fixture.member, quote.id, content(), deps),
      ).rejects.toBeInstanceOf(NotFoundError);
      const version = await getQuoteDetail(fixture.viewer, (await draft()).id, {
        versionNumber: 1,
      });
      await expect(
        getQuoteDetail(fixture.viewer, version.quote.id, { versionNumber: 9 }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("chiffrage côté serveur", () => {
    it("calcule total, TVA, acompte et marge", () => {
      const totals = computeTotals([
        { ...LINE, recurring: false },
        {
          quantity: 1,
          unitPriceCents: 195_000,
          estimatedCostCents: 72_000,
          estimatedMinutes: 1260,
          recurring: false,
        },
        {
          quantity: 1,
          unitPriceCents: 4900,
          estimatedCostCents: 900,
          estimatedMinutes: 10,
          recurring: true,
        },
      ]);
      // Les valeurs de l'écran 09 : 9 750 € HT, 3 600 € de coût, 15 j à 7 h, 63 %.
      expect(totals).toEqual({
        totalCents: 975_000,
        estimatedCostCents: 360_000,
        estimatedMinutes: 6300,
        recurringCents: 4900,
      });
      const amounts = computeAmounts({ ...totals, taxPercent: 20, depositPercent: 30 });
      expect(amounts.taxCents).toBe(195_000);
      expect(amounts.depositCents).toBe(292_500);
      expect(Math.round(amounts.marginPercent ?? 0)).toBe(63);
      expect(
        computeAmounts({ ...totals, totalCents: 0, taxPercent: 20, depositPercent: 0 })
          .marginPercent,
      ).toBeNull();
    });

    it("ignore tout total envoyé par le navigateur", async () => {
      const quote = await draft();
      await saveQuoteContent(
        fixture.member,
        quote.id,
        content({ totalCents: 1, estimatedCostCents: 1 }),
        deps,
      );
      const detail = await getQuoteDetail(fixture.member, quote.id);
      expect(detail.version.totalCents).toBe(780_000);
      expect(detail.version.estimatedCostCents).toBe(288_000);
      expect(detail.version.estimatedMinutes).toBe(5040);
    });

    it("multiplie par la quantité, et laisse une ligne récurrente hors total", async () => {
      const recurring = await createCatalogItem(fixture.admin, {
        kind: "recurring",
        activity: "hebergement",
        name: "Hébergement",
        priceCents: 4900,
        estimatedCostCents: 900,
        estimatedMinutes: 10,
      });
      const quote = await draft();
      await saveQuoteContent(
        fixture.member,
        quote.id,
        content({
          lines: [
            { ...LINE, quantity: 2 },
            {
              catalogItemId: recurring.id,
              label: "Hébergement",
              unitLabel: "/mois",
              quantity: 1,
              unitPriceCents: 4900,
              estimatedCostCents: 900,
              estimatedMinutes: 10,
            },
          ],
        }),
        deps,
      );
      const detail = await getQuoteDetail(fixture.member, quote.id);
      expect(detail.version.totalCents).toBe(1_560_000);
      expect(detail.version.estimatedCostCents).toBe(576_000);
      expect(detail.recurringCents).toBe(4900);
      expect(detail.lines.find((line) => line.recurring)?.label).toBe("Hébergement");
    });

    it("refuse une ligne invalide, une prestation inconnue et un total hors limite", async () => {
      const quote = await draft();
      await expect(
        saveQuoteContent(
          fixture.member,
          quote.id,
          content({ lines: [{ ...LINE, quantity: 0 }] }),
          deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        saveQuoteContent(
          fixture.member,
          quote.id,
          content({ lines: [{ ...LINE, catalogItemId: "9f2b6a0e-0000-4000-8000-000000000000" }] }),
          deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        saveQuoteContent(
          fixture.member,
          quote.id,
          content({ lines: [{ ...LINE, quantity: 10_000, unitPriceCents: 100_000_000 }] }),
          deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("n'expose aucun coût interne dans le document client", async () => {
      const quote = await draft();
      await saveQuoteContent(fixture.member, quote.id, content(), deps);
      const { document } = await getQuoteDocument(fixture.viewer, quote.id);
      const text = JSON.stringify(document);
      expect(text).not.toContain("2 880");
      expect(text).not.toMatch(/co[uû]t|rentabilit|marge/i);
      expect(document.summary.map((row) => row.label)).toContain("TVA 20 %");
    });
  });

  describe("catalogue et lignes", () => {
    it("fige les lignes même si le catalogue change, et refuse une prestation retirée", async () => {
      const item = await createCatalogItem(fixture.admin, {
        kind: "project",
        activity: "vitrine",
        name: "Vitrine catalogue",
        priceCents: 500_000,
        estimatedCostCents: 200_000,
        estimatedMinutes: 2100,
      });
      const line = {
        catalogItemId: item.id,
        label: item.name,
        quantity: 1,
        unitPriceCents: 500_000,
        estimatedCostCents: 200_000,
        estimatedMinutes: 2100,
      };
      const quote = await draft();
      await saveQuoteContent(fixture.member, quote.id, content({ lines: [line] }), deps);

      await updateCatalogItem(fixture.admin, item.id, {
        kind: "project",
        activity: "vitrine",
        name: "Vitrine catalogue",
        priceCents: 999_000,
        estimatedCostCents: 1,
        estimatedMinutes: 1,
      });
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.lines[0]?.unitPriceCents).toBe(500_000);
      expect(detail.version.totalCents).toBe(500_000);

      await setCatalogItemActive(fixture.admin, item.id, false);
      const other = await draft();
      await expect(
        saveQuoteContent(fixture.member, other.id, content({ lines: [line] }), deps),
      ).rejects.toBeInstanceOf(ConflictError);
      // Déjà présente dans ce devis : elle reste acceptée.
      await saveQuoteContent(fixture.member, quote.id, content({ lines: [line] }), deps);
    });
  });

  describe("versions", () => {
    it("réécrit une version jamais envoyée, sans en créer", async () => {
      const quote = await draft();
      await saveQuoteContent(fixture.member, quote.id, content(), deps);
      await saveQuoteContent(
        fixture.member,
        quote.id,
        content({ lines: [{ ...LINE, unitPriceCents: 100_000 }] }),
        deps,
      );
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.versions).toHaveLength(1);
      expect(detail.version.totalCents).toBe(100_000);
      expect(detail.lines).toHaveLength(1);
    });

    it("fige la version envoyée et crée la suivante en cas de changement", async () => {
      const quote = await sentQuote();
      const before = await getQuoteDetail(fixture.viewer, quote.id);
      expect(before.version.sentAt).not.toBeNull();

      // Sans explication : refusé.
      const changed = content({ lines: [{ ...LINE, unitPriceCents: 900_000 }] });
      await expect(
        saveQuoteContent(fixture.member, quote.id, changed, deps),
      ).rejects.toBeInstanceOf(ValidationError);

      await saveQuoteContent(
        fixture.member,
        quote.id,
        { ...changed, changeNote: "Options modifiées" },
        deps,
      );
      const after = await getQuoteDetail(fixture.viewer, quote.id);
      expect(after.versions.map((version) => version.version)).toEqual([2, 1]);
      expect(after.version).toMatchObject({
        version: 2,
        totalCents: 900_000,
        sentAt: null,
        changeNote: "Options modifiées",
      });
      expect(after.quote.status).toBe("sent");
      expect(after.actions.send).toBe(true);

      const frozen = await getQuoteDetail(fixture.viewer, quote.id, { versionNumber: 1 });
      expect(frozen.version.totalCents).toBe(780_000);
      expect(frozen.lines[0]?.unitPriceCents).toBe(780_000);
      expect(frozen.isCurrentVersion).toBe(false);

      const rows = await fixture.db
        .select()
        .from(quoteLines)
        .where(eq(quoteLines.quoteVersionId, before.version.id));
      expect(rows).toHaveLength(1);

      // Répéter sur la version 2, encore en préparation, n'en crée pas de troisième.
      await saveQuoteContent(
        fixture.member,
        quote.id,
        { ...changed, changeNote: "Options modifiées" },
        deps,
      );
      expect((await getQuoteDetail(fixture.viewer, quote.id)).versions).toHaveLength(2);

      // Envoyer la version 2 reste sur « sent » et émet un nouvel événement.
      await markQuoteSentManually(fixture.member, quote.id);
      const events = await fixture.db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, "quote.sent"), eq(domainEvents.entityId, quote.id)));
      expect(events).toHaveLength(2);
    });

    it("ne crée pas de version si le contenu envoyé est identique", async () => {
      const quote = await sentQuote();
      await saveQuoteContent(fixture.member, quote.id, content(), deps);
      expect((await getQuoteDetail(fixture.viewer, quote.id)).versions).toHaveLength(1);
    });
  });

  describe("envoi manuel", () => {
    it("refuse un devis sans ligne ou sans validité", async () => {
      const empty = await draft();
      await expect(markQuoteSentManually(fixture.member, empty.id)).rejects.toBeInstanceOf(
        ConflictError,
      );

      const noValidity = await draft();
      await saveQuoteContent(fixture.member, noValidity.id, content({ validUntil: "" }), deps);
      await expect(markQuoteSentManually(fixture.member, noValidity.id)).rejects.toBeInstanceOf(
        ConflictError,
      );

      const past = await draft();
      await saveQuoteContent(fixture.member, past.id, content({ validUntil: "2020-01-01" }), deps);
      await expect(markQuoteSentManually(fixture.member, past.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("passe à « sent », avance l'affaire, émet une seule fois", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const quote = await sentQuote({ companyId, opportunityId: opportunity.id });
      expect(quote).toMatchObject({ status: "sent", signatureStatus: "unavailable" });
      expect(quote.sentAt).not.toBeNull();

      const [row] = await fixture.db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunity.id));
      expect(row?.stage).toBe("QUOTE_SENT");

      await markQuoteSentManually(fixture.member, quote.id);
      const events = await fixture.db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, "quote.sent"), eq(domainEvents.entityId, quote.id)));
      expect(events).toHaveLength(1);
    });

    it("annule tout si Twenty est coupé", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const quote = await draft({ companyId, opportunityId: opportunity.id });
      await saveQuoteContent(fixture.member, quote.id, content(), deps);

      fixture.crm.simulateOutage();
      await expect(markQuoteSentManually(fixture.member, quote.id)).rejects.toBeInstanceOf(
        IntegrationError,
      );
      fixture.crm.endOutage();

      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.quote.status).toBe("draft");
      expect(detail.version.sentAt).toBeNull();
      const events = await fixture.db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, "quote.sent"), eq(domainEvents.entityId, quote.id)));
      expect(events).toHaveLength(0);
    });
  });

  describe("acceptation manuelle", () => {
    it("exige la référence du document signé et une date passée", async () => {
      const quote = await sentQuote();
      await expect(
        acceptQuoteManually(fixture.member, quote.id, { signedOn: "2026-01-15" }, deps),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        acceptQuoteManually(
          fixture.member,
          quote.id,
          { indyReference: "X", signedOn: "2999-01-01" },
          deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        acceptQuoteManually(
          fixture.member,
          quote.id,
          { officialDocumentUrl: "javascript:alert(1)", signedOn: "2026-01-15" },
          deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepte en une transaction : devis, affaire, projet, événement, audit", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const quote = await sentQuote({ companyId, opportunityId: opportunity.id });

      const result = await acceptQuoteManually(
        fixture.member,
        quote.id,
        { ...ACCEPTANCE, note: "Reçu par courrier" },
        deps,
      );
      expect(result.alreadyAccepted).toBe(false);
      expect(result.projectId).not.toBeNull();

      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.quote).toMatchObject({
        status: "accepted",
        signatureStatus: "signed",
        indyReference: "INDY-42",
        acceptedVersionId: detail.version.id,
      });
      expect(detail.quote.signedAt?.toISOString().slice(0, 10)).toBe("2026-01-15");
      expect(detail.actions).toMatchObject({ amend: true, edit: false, accept: false });

      const [won] = await fixture.db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunity.id));
      expect(won?.stage).toBe("WON");

      const created = await fixture.db
        .select()
        .from(projects)
        .where(eq(projects.quoteId, quote.id));
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ companyId, budgetCents: 780_000 });

      const events = await fixture.db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, "quote.accepted"), eq(domainEvents.entityId, quote.id)));
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        number: quote.number,
        opportunityId: opportunity.id,
        totalCents: 780_000,
      });

      const signed = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "quote.signed"), eq(auditLog.entityId, quote.id)));
      expect(signed[0]?.metadata).toMatchObject({
        method: "manual",
        indyReference: "INDY-42",
        note: "Reçu par courrier",
      });
      expect(signed[0]?.actorId).toBe(fixture.member.actor.userId);
    });

    it("est idempotente : ni second projet ni second événement", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const quote = await sentQuote({ companyId, opportunityId: opportunity.id });
      await acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps);
      const again = await acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps);
      expect(again.alreadyAccepted).toBe(true);

      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toHaveLength(1);
      expect(
        await fixture.db
          .select()
          .from(domainEvents)
          .where(and(eq(domainEvents.type, "quote.accepted"), eq(domainEvents.entityId, quote.id))),
      ).toHaveLength(1);
    });

    it("ne garde rien si Twenty est coupé : tout se rejoue ensuite", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const quote = await sentQuote({ companyId, opportunityId: opportunity.id });

      fixture.crm.simulateOutage();
      await expect(
        acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps),
      ).rejects.toBeInstanceOf(IntegrationError);
      fixture.crm.endOutage();

      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, quote.id));
      expect(row?.status).toBe("sent");
      expect(row?.acceptedVersionId).toBeNull();
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toEqual([]);

      await acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps);
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toHaveLength(1);
    });

    it("accepte la dernière version envoyée, pas celle en préparation", async () => {
      const quote = await sentQuote();
      await saveQuoteContent(
        fixture.member,
        quote.id,
        {
          ...content({ lines: [{ ...LINE, unitPriceCents: 111_000 }] }),
          changeNote: "Brouillon v2",
        },
        deps,
      );
      await acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps);
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.version.version).toBe(1);
      expect(detail.version.totalCents).toBe(780_000);
      expect(detail.quote.acceptedVersionId).toBe(detail.version.id);
      expect(detail.quote.currentVersionId).toBe(detail.version.id);
      const [project] = await fixture.db
        .select()
        .from(projects)
        .where(eq(projects.quoteId, quote.id));
      expect(project?.budgetCents).toBe(780_000);
    });

    it("accepte depuis la négociation", async () => {
      const quote = await sentQuote();
      await markQuoteNegotiation(fixture.member, quote.id);
      const result = await acceptQuoteManually(fixture.member, quote.id, ACCEPTANCE, deps);
      expect(result.quote.status).toBe("accepted");
    });
  });

  describe("avenants", () => {
    it("exige un devis signé et ne recrée pas de projet", async () => {
      const original = await sentQuote();
      await expect(
        createAmendment(fixture.member, original.id, { title: "Trop tôt" }),
      ).rejects.toBeInstanceOf(ConflictError);

      await acceptQuoteManually(fixture.member, original.id, ACCEPTANCE, deps);
      const amendment = await createAmendment(fixture.member, original.id, {
        title: "Page Galerie",
      });
      expect(amendment.parentQuoteId).toBe(original.id);
      expect(amendment.companyId).toBe(original.companyId);
      expect(amendment.number).not.toBe(original.number);
      expect(amendment.opportunityId).toBeNull();

      const parent = await getQuoteDetail(fixture.viewer, original.id);
      expect(parent.amendments.map((item) => item.id)).toEqual([amendment.id]);
      const child = await getQuoteDetail(fixture.viewer, amendment.id);
      expect(child.parent?.id).toBe(original.id);
      expect(child.version.scope).toBe("5 pages");
      expect(child.actions.amend).toBe(false);

      await expect(
        createAmendment(fixture.member, amendment.id, { title: "Avenant d'avenant" }),
      ).rejects.toBeInstanceOf(ConflictError);

      await saveQuoteContent(
        fixture.member,
        amendment.id,
        content({ lines: [{ ...LINE, label: "Page Galerie", unitPriceCents: 60_000 }] }),
        deps,
      );
      await markQuoteSentManually(fixture.member, amendment.id);
      const accepted = await acceptQuoteManually(fixture.member, amendment.id, ACCEPTANCE, deps);
      expect(accepted.projectId).toBeNull();
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, amendment.id)),
      ).toEqual([]);
    });

    it("reprend une demande supplémentaire acceptée, une seule fois et sans lien croisé", async () => {
      const original = await sentQuote();
      await acceptQuoteManually(fixture.member, original.id, ACCEPTANCE, deps);
      const [request] = await fixture.db
        .insert(changeRequests)
        .values({
          companyId: original.companyId,
          title: "Page Galerie",
          status: "accepted",
          amountCents: 60_000,
          estimatedMinutes: 480,
        })
        .returning();
      if (!request) throw new Error("Demande non créée.");

      const options = await getAmendmentOptions(fixture.member, original.companyId);
      expect(options.map((option) => option.id)).toEqual([request.id]);

      const amendment = await createAmendment(fixture.member, original.id, {
        title: "Page Galerie",
        changeRequestId: request.id,
      });
      const detail = await getQuoteDetail(fixture.viewer, amendment.id);
      expect(detail.version.totalCents).toBe(60_000);
      expect(detail.lines.map((line) => line.label)).toEqual(["Page Galerie"]);
      const [linked] = await fixture.db
        .select()
        .from(changeRequests)
        .where(eq(changeRequests.id, request.id));
      expect(linked).toMatchObject({ status: "converted", quoteId: amendment.id });

      // Rejouer le même formulaire ne crée pas de second avenant.
      await expect(
        createAmendment(fixture.member, original.id, {
          title: "Page Galerie",
          changeRequestId: request.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      const parent = await getQuoteDetail(fixture.viewer, original.id);
      expect(parent.amendments.map((item) => item.id)).toEqual([amendment.id]);
    });
  });

  describe("expiration", () => {
    it("refuse d'expirer tant que la validité court", async () => {
      const quote = await sentQuote();
      await expect(expireQuote(fixture.member, quote.id)).rejects.toBeInstanceOf(ConflictError);
      const later = new Date(Date.now() + 40 * DAY);
      const expired = await expireQuote(fixture.member, quote.id, later);
      expect(expired.status).toBe("expired");
      await expireQuote(fixture.member, quote.id, later);
      expect(
        await fixture.db
          .select()
          .from(domainEvents)
          .where(and(eq(domainEvents.type, "quote.expired"), eq(domainEvents.entityId, quote.id))),
      ).toHaveLength(1);
    });

    it("expire les devis dépassés en tâche planifiée, sans toucher aux autres", async () => {
      const quote = await sentQuote();
      const negotiating = await sentQuote();
      await markQuoteNegotiation(fixture.member, negotiating.id);
      const later = new Date(Date.now() + 40 * DAY);

      const expired = await expireOverdueQuotes(fixture.db, later);
      expect(expired).toContain(quote.id);
      expect(expired).not.toContain(negotiating.id);
      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, quote.id));
      expect(row?.status).toBe("expired");

      expect(await expireOverdueQuotes(fixture.db, later)).not.toContain(quote.id);
      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "quote.expired"), eq(auditLog.entityId, quote.id)));
      expect(audit[0]?.actorId).toBeNull();
    });

    it("se fonde sur la dernière version envoyée, pas sur celle en préparation", async () => {
      const quote = await sentQuote();
      await saveQuoteContent(
        fixture.member,
        quote.id,
        { ...content({ validUntil: "2099-01-01" }), changeNote: "Prolongée, pas encore envoyée" },
        deps,
      );
      const later = new Date(Date.now() + 40 * DAY);
      expect(await expireOverdueQuotes(fixture.db, later)).toContain(quote.id);
    });
  });

  describe("relance J+7", () => {
    it("liste les devis envoyés depuis 7 jours et les retire après la relance", async () => {
      const quote = await sentQuote();
      const sentAt = quote.sentAt as Date;

      const before = await listQuotesDueForReminder(
        fixture.db,
        new Date(sentAt.getTime() + 6 * DAY),
      );
      expect(before.some((row) => row.id === quote.id)).toBe(false);

      const due = new Date(sentAt.getTime() + 7 * DAY);
      const list = await listQuotesDueForReminder(fixture.db, due);
      expect(list.find((row) => row.id === quote.id)).toMatchObject({
        number: quote.number,
        totalCents: 780_000,
      });

      await fixture.db.transaction(async (tx) => {
        expect(await recordQuoteReminder(tx, { quoteId: quote.id, now: due })).toBe(true);
        // Répété le même jour : sans effet.
        expect(await recordQuoteReminder(tx, { quoteId: quote.id, now: due })).toBe(false);
      });
      const after = await listQuotesDueForReminder(fixture.db, due);
      expect(after.some((row) => row.id === quote.id)).toBe(false);

      const nextWeek = new Date(due.getTime() + 7 * DAY);
      const again = await listQuotesDueForReminder(fixture.db, nextWeek);
      expect(again.some((row) => row.id === quote.id)).toBe(true);
    });

    it("exclut un brouillon, un devis signé ou refusé", async () => {
      const later = new Date(Date.now() + 8 * DAY);
      const quote = await draft();
      const accepted = await sentQuote();
      await acceptQuoteManually(fixture.member, accepted.id, ACCEPTANCE, deps);
      const refused = await sentQuote();
      await refuseQuote(fixture.member, refused.id, { reason: "Non" }, deps);
      const ids = (await listQuotesDueForReminder(fixture.db, later)).map((row) => row.id);
      expect(ids).not.toContain(quote.id);
      expect(ids).not.toContain(accepted.id);
      expect(ids).not.toContain(refused.id);
    });
  });

  describe("références", () => {
    it("garde les références, refuse une adresse dangereuse, sans écriture inutile", async () => {
      const quote = await draft();
      await updateQuoteReferences(fixture.member, quote.id, {
        indyReference: "INDY-1",
        officialDocumentUrl: "https://indy.test/d/1",
      });
      await updateQuoteReferences(fixture.member, quote.id, {
        indyReference: "INDY-1",
        officialDocumentUrl: "https://indy.test/d/1",
      });
      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "quote.updated"), eq(auditLog.entityId, quote.id)));
      expect(audit).toHaveLength(1);
      await expect(
        updateQuoteReferences(fixture.member, quote.id, {
          officialDocumentUrl: "javascript:alert(1)",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("archivage", () => {
    it("archive un brouillon ou un devis clos, pas un devis en cours ni signé", async () => {
      const running = await sentQuote();
      await expect(archiveQuote(fixture.member, running.id)).rejects.toBeInstanceOf(ConflictError);
      await acceptQuoteManually(fixture.member, running.id, ACCEPTANCE, deps);
      await expect(archiveQuote(fixture.member, running.id)).rejects.toBeInstanceOf(ConflictError);

      const quote = await draft();
      await archiveQuote(fixture.member, quote.id);
      await archiveQuote(fixture.member, quote.id);
      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "quote.archived"), eq(auditLog.entityId, quote.id)));
      expect(audit).toHaveLength(1);
      const list = await listQuotes(fixture.viewer, { search: quote.number });
      expect(list.total).toBe(0);
      await expect(archiveQuote(fixture.member, "abc")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("listes", () => {
    it("pagine côté serveur, filtre, cherche et résume", async () => {
      const company = await createCompany(fixture.db, { name: "Pagination Durand" });
      for (let index = 0; index < 45; index += 1) {
        await createQuote(fixture.member, {
          companyId: company.id,
          title: `Offre ${index}`,
        });
      }
      const page = await listQuotes(fixture.viewer, { search: "Pagination Durand", pageSize: 20 });
      expect(page.items).toHaveLength(20);
      expect(page.total).toBe(45);
      const third = await listQuotes(fixture.viewer, {
        search: "Pagination Durand",
        pageSize: 20,
        page: 3,
      });
      expect(third.items).toHaveLength(5);
      expect(third.items[0]?.companyName).toBe("Pagination Durand");

      const company2 = await listQuotesForCompany(fixture.viewer, company.id, { limit: 3 });
      expect(company2).toHaveLength(3);
      expect(company2[0]).toMatchObject({ status: "draft", totalCents: 0, isAmendment: false });

      const percent = await listQuotes(fixture.viewer, { search: "%_%" });
      expect(percent.total).toBe(0);
    });

    it("regroupe les filtres de l'écran 09", async () => {
      const company = await createCompany(fixture.db, { name: "Filtres Martin" });
      const search = "Filtres Martin";
      const draftQuote = await draft({ companyId: company.id });
      const sent = await sentQuote({ companyId: company.id });
      const negotiating = await sentQuote({ companyId: company.id });
      await markQuoteNegotiation(fixture.member, negotiating.id);
      const refused = await sentQuote({ companyId: company.id });
      await refuseQuote(fixture.member, refused.id, { reason: "Non" }, deps);
      const signed = await sentQuote({ companyId: company.id });
      await acceptQuoteManually(fixture.member, signed.id, ACCEPTANCE, deps);

      const ids = async (filter: "brouillons" | "envoyes" | "signes" | "refuses") =>
        (await listQuotes(fixture.viewer, { search, filter })).items.map((row) => row.id).sort();
      expect(await ids("brouillons")).toEqual([draftQuote.id]);
      expect(await ids("envoyes")).toEqual([sent.id, negotiating.id].sort());
      expect(await ids("signes")).toEqual([signed.id]);
      expect(await ids("refuses")).toEqual([refused.id]);
    });

    it("résume à signer, signés ce mois et leur montant", async () => {
      const before = await getQuoteSummary(fixture.viewer);
      const quote = await sentQuote();
      const signed = await sentQuote();
      await acceptQuoteManually(fixture.member, signed.id, ACCEPTANCE, deps);
      const after = await getQuoteSummary(fixture.viewer);
      expect(after.toSignCount).toBe(before.toSignCount + 1);
      expect(after.signedThisMonthCount).toBe(before.signedThisMonthCount + 1);
      expect(after.totalCents).toBe(before.totalCents + 2 * 780_000);
      await refuseQuote(fixture.member, quote.id, { reason: "Non" }, deps);
      expect((await getQuoteSummary(fixture.viewer)).toSignCount).toBe(before.toSignCount);
    });
  });

  it("calcule le début du mois à Paris, heure d'été comme d'hiver", () => {
    expect(startOfMonthInParis(new Date("2026-11-04T10:00:00Z")).toISOString()).toBe(
      "2026-10-31T23:00:00.000Z",
    );
    expect(startOfMonthInParis(new Date("2026-07-15T10:00:00Z")).toISOString()).toBe(
      "2026-06-30T22:00:00.000Z",
    );
    // Le 1er à 00:30 à Paris appartient déjà au nouveau mois.
    expect(startOfMonthInParis(new Date("2026-10-31T23:30:00Z")).toISOString()).toBe(
      "2026-10-31T23:00:00.000Z",
    );
  });

  it("ne réécrit jamais une version envoyée en base", async () => {
    const quote = await sentQuote();
    const [frozen] = await fixture.db
      .select()
      .from(quoteVersions)
      .where(eq(quoteVersions.quoteId, quote.id));
    await saveQuoteContent(
      fixture.member,
      quote.id,
      { ...content({ scope: "Autre périmètre" }), changeNote: "Périmètre revu" },
      deps,
    );
    const [unchanged] = await fixture.db
      .select()
      .from(quoteVersions)
      .where(eq(quoteVersions.id, frozen?.id ?? ""));
    expect(unchanged?.scope).toBe("5 pages");
    expect(unchanged?.updatedAt).toEqual(frozen?.updatedAt);
  });
});
