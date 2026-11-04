import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkDocusealSignature,
  DocusealWebhookRejectedError,
  parseDocusealWebhook,
  receiveDocusealWebhook,
} from "@/integrations/docuseal/docuseal.webhook";
import {
  acceptQuoteManually,
  getSignatureAvailability,
  getSignerOptions,
  markQuoteSentManually,
  processDocusealWebhook,
  refreshQuoteSignature,
  sendQuoteForSignature,
} from "@/modules/quotes/quote-signature.service";
import { buildQuoteDocument, renderSignatureHtml } from "@/modules/quotes/quote.document";
import { signatureExternalId } from "@/modules/quotes/quote.rules";
import {
  createQuote,
  getQuoteDetail,
  refuseQuote,
  saveQuoteContent,
} from "@/modules/quotes/quote.service";
import {
  auditLog,
  domainEvents,
  opportunities,
  projects,
  quotes,
  users,
  webhookReceipts,
} from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  IntegrationError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { createTestDatabase } from "../../helpers/db";
import { createCompany, createContact } from "../../helpers/factories";
import {
  content,
  createCrmOpportunity,
  createFixture,
  DocusealStub,
  LINE,
  UNCONFIGURED_DEPS,
  type Fixture,
} from "./helpers";

const SECRET = "whsec_secret_de_test_0123456789";

function sign(rawBody: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `${timestamp}.${digest}`;
}

describe("signature DocuSeal", () => {
  let close: () => Promise<void>;
  let fixture: Fixture;
  const stub = new DocusealStub();

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
  beforeEach(() => {
    stub.failWith = null;
    stub.submissionStatus = "pending";
  });

  async function prepared(options: { companyId?: string; opportunityId?: string } = {}) {
    const companyId = options.companyId ?? (await createCompany(fixture.db)).id;
    const contact = await createContact(fixture.db, {
      companyId,
      email: `signature-${Math.random().toString(36).slice(2)}@test.local`,
    });
    const quote = await createQuote(fixture.member, {
      companyId,
      opportunityId: options.opportunityId,
      title: "Site vitrine",
    });
    await saveQuoteContent(fixture.member, quote.id, content(), stub.deps());
    return { quote, contact, companyId };
  }

  async function sent(options: { companyId?: string; opportunityId?: string } = {}) {
    const data = await prepared(options);
    const quote = await sendQuoteForSignature(
      fixture.member,
      data.quote.id,
      { signerContactId: data.contact.id },
      stub.deps(),
    );
    return { ...data, quote };
  }

  describe("connexion absente", () => {
    it("signale la connexion requise sans rien écrire", async () => {
      expect(getSignatureAvailability(UNCONFIGURED_DEPS)).toEqual({ configured: false });
      const { quote, contact } = await prepared();
      const attempt = sendQuoteForSignature(
        fixture.member,
        quote.id,
        { signerContactId: contact.id },
        UNCONFIGURED_DEPS,
      );
      await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableError);
      await expect(attempt).rejects.toMatchObject({
        reason: "not_configured",
        connectionRequired: true,
      });

      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.quote).toMatchObject({ status: "draft", signatureStatus: "none" });
      expect(detail.version.sentAt).toBeNull();
    });

    it("laisse le parcours manuel complet disponible", async () => {
      const { quote } = await prepared();
      const marked = await markQuoteSentManually(fixture.member, quote.id);
      expect(marked).toMatchObject({ status: "sent", signatureStatus: "unavailable" });
      const accepted = await acceptQuoteManually(
        fixture.member,
        quote.id,
        { officialDocumentUrl: "https://indy.test/signe.pdf", signedOn: "2026-01-02" },
        UNCONFIGURED_DEPS,
      );
      expect(accepted.quote).toMatchObject({
        status: "accepted",
        signatureStatus: "signed",
        officialDocumentUrl: "https://indy.test/signe.pdf",
      });
    });
  });

  describe("envoi", () => {
    it("crée la demande selon l'API documentée et enregistre l'envoi", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const { quote, contact } = await prepared({ companyId, opportunityId: opportunity.id });
      const before = stub.createCalls.length;

      const updated = await sendQuoteForSignature(
        fixture.member,
        quote.id,
        { signerContactId: contact.id },
        stub.deps("ma-cle"),
      );

      expect(stub.createCalls).toHaveLength(before + 1);
      const call = stub.createCalls.at(-1);
      expect(call).toMatchObject({ path: "/submissions/html", token: "ma-cle" });
      const body = call?.body as {
        name: string;
        send_email: boolean;
        expire_at: string;
        documents: { name: string; html: string; size: string }[];
        submitters: { role: string; email: string; external_id: string }[];
      };
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(body.send_email).toBe(true);
      expect(body.expire_at).toMatch(/^\d{4}-\d{2}-\d{2} 23:59:59 UTC$/);
      expect(body.documents[0]?.size).toBe("A4");
      expect(body.submitters[0]).toMatchObject({
        role: "Client",
        email: contact.email,
        external_id: signatureExternalId(quote.id, detail.version.id),
      });
      const html = body.documents[0]?.html ?? "";
      expect(html).toContain('<signature-field name="Signature" role="Client"');
      expect(html).toContain("Site vitrine · 5 pages");
      // Rien d'interne ne part chez le client.
      expect(html).not.toMatch(/co[uû]t|rentabilit|marge|2\s?880/i);

      expect(updated).toMatchObject({ status: "sent", signatureStatus: "pending" });
      expect(updated.docusealSubmissionId).toMatch(/^\d+$/);
      expect(detail.version.sentAt).not.toBeNull();

      const [row] = await fixture.db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunity.id));
      expect(row?.stage).toBe("QUOTE_SENT");

      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "quote.signature_requested"), eq(auditLog.entityId, quote.id)),
        );
      expect(audit[0]?.metadata).toMatchObject({ signerEmail: contact.email });
    });

    it("ne crée pas de seconde demande si on répète, même en parallèle", async () => {
      const { quote, contact } = await prepared();
      const before = stub.createCalls.length;
      const input = { signerContactId: contact.id };
      await Promise.all([
        sendQuoteForSignature(fixture.member, quote.id, input, stub.deps()),
        sendQuoteForSignature(fixture.member, quote.id, input, stub.deps()),
      ]);
      await sendQuoteForSignature(fixture.member, quote.id, input, stub.deps());
      expect(stub.createCalls).toHaveLength(before + 1);
    });

    it("annule tout si DocuSeal tombe en panne", async () => {
      const { quote, contact } = await prepared();
      stub.failWith = 500;
      const attempt = sendQuoteForSignature(
        fixture.member,
        quote.id,
        { signerContactId: contact.id },
        stub.deps(),
      );
      await expect(attempt).rejects.toMatchObject({ reason: "unreachable" });
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.quote).toMatchObject({ status: "draft", signatureStatus: "none" });
      expect(detail.version.sentAt).toBeNull();
      expect(
        await fixture.db
          .select()
          .from(domainEvents)
          .where(and(eq(domainEvents.type, "quote.sent"), eq(domainEvents.entityId, quote.id))),
      ).toEqual([]);
    });

    it("distingue une clé refusée et une demande rejetée", async () => {
      const { quote, contact } = await prepared();
      stub.failWith = 401;
      await expect(
        sendQuoteForSignature(
          fixture.member,
          quote.id,
          { signerContactId: contact.id },
          stub.deps(),
        ),
      ).rejects.toMatchObject({ reason: "unauthorized", connectionRequired: true });
      stub.failWith = 422;
      await expect(
        sendQuoteForSignature(
          fixture.member,
          quote.id,
          { signerContactId: contact.id },
          stub.deps(),
        ),
      ).rejects.toBeInstanceOf(IntegrationError);
    });

    it("ne contacte pas le client si Twenty est coupé", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const { quote, contact } = await prepared({ companyId, opportunityId: opportunity.id });
      const before = stub.createCalls.length;
      fixture.crm.simulateOutage();
      await expect(
        sendQuoteForSignature(
          fixture.member,
          quote.id,
          { signerContactId: contact.id },
          stub.deps(),
        ),
      ).rejects.toBeInstanceOf(IntegrationError);
      fixture.crm.endOutage();
      expect(stub.createCalls).toHaveLength(before);
      expect((await getQuoteDetail(fixture.viewer, quote.id)).quote.status).toBe("draft");
    });

    it("refuse un contact d'un autre client, ou sans e-mail", async () => {
      const { quote } = await prepared();
      const foreign = await createContact(fixture.db);
      await expect(
        sendQuoteForSignature(
          fixture.member,
          quote.id,
          { signerContactId: foreign.id },
          stub.deps(),
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      const withoutEmail = await createContact(fixture.db, {
        companyId: quote.companyId,
        email: null,
      });
      await expect(
        sendQuoteForSignature(
          fixture.member,
          quote.id,
          { signerContactId: withoutEmail.id },
          stub.deps(),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("réserve l'envoi aux rôles autorisés", async () => {
      const { quote, contact } = await prepared();
      for (const ctx of [fixture.viewer, fixture.contractor, fixture.client]) {
        await expect(
          sendQuoteForSignature(ctx, quote.id, { signerContactId: contact.id }, stub.deps()),
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(getSignerOptions(ctx, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(refreshQuoteSignature(ctx, quote.id, stub.deps())).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
    });

    it("échappe le contenu saisi dans le document envoyé", () => {
      const html = renderSignatureHtml(
        buildQuoteDocument({
          number: "D-1",
          title: 'Offre <signature-field name="piège">',
          issuedByNote: "<script>alert(1)</script>",
          indyReference: null,
          company: {
            name: "A & B",
            addressLine: null,
            postalCode: null,
            city: null,
            country: null,
          },
          version: {
            version: 1,
            scope: "<img src=x>",
            exclusions: null,
            conditions: null,
            validUntil: null,
            depositPercent: 0,
            totalCents: 100,
            estimatedCostCents: 50,
            taxPercent: 20,
            sentAt: null,
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
          lines: [],
        }),
      );
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img");
      expect(html).toContain("A &amp; B");
      // Une seule balise de signature : celle du document, pas celle saisie.
      expect(html.match(/<signature-field/g)).toHaveLength(1);
    });
  });

  describe("signature du webhook", () => {
    const body = JSON.stringify({ event_type: "submission.completed", data: { id: 1 } });

    it("accepte une signature valide", () => {
      expect(checkDocusealSignature({ rawBody: body, header: sign(body), secret: SECRET })).toEqual(
        {
          valid: true,
        },
      );
    });

    it("rejette un corps modifié, un mauvais secret, un en-tête absent, un rejeu ancien", () => {
      const reasonOf = (header: string | null, raw = body) => {
        const result = checkDocusealSignature({ rawBody: raw, header, secret: SECRET });
        return result.valid ? "valid" : result.reason;
      };
      expect(reasonOf(sign(body), `${body} `)).toBe("invalid_signature");
      expect(reasonOf(sign(body, "whsec_autre_secret_0000000000"))).toBe("invalid_signature");
      expect(reasonOf(null)).toBe("missing_header");
      expect(reasonOf("sans-point")).toBe("invalid_signature");
      expect(reasonOf("abc.def")).toBe("invalid_signature");
      const old = Math.floor(Date.now() / 1000) - 3600;
      expect(reasonOf(sign(body, SECRET, old))).toBe("stale_timestamp");
    });

    it("lève une erreur typée à la réception, et refuse un corps illisible", () => {
      expect(() =>
        receiveDocusealWebhook({ rawBody: body, headers: new Headers(), secret: SECRET }),
      ).toThrow(DocusealWebhookRejectedError);
      expect(() => parseDocusealWebhook("pas du json")).toThrow(ValidationError);
      expect(() => parseDocusealWebhook(JSON.stringify({ data: {} }))).toThrow(ValidationError);
      expect(() =>
        parseDocusealWebhook(JSON.stringify({ event_type: "submission.completed", data: {} })),
      ).toThrow(ValidationError);
    });

    it("interprète les événements d'après leur forme documentée", () => {
      const completed = parseDocusealWebhook(
        JSON.stringify({
          event_type: "submission.completed",
          timestamp: "2023-09-24T11:20:42Z",
          data: {
            id: 7,
            status: "completed",
            completed_at: "2023-09-24T11:20:40Z",
            submitters: [{ id: 3, external_id: "ext" }],
          },
        }),
      );
      expect(completed).toMatchObject({
        type: "submission.completed",
        receiptId: "submission.completed:7",
        submissionId: "7",
        externalIds: ["ext"],
      });
      const declined = parseDocusealWebhook(
        JSON.stringify({
          event_type: "form.declined",
          data: { id: 3, decline_reason: "Trop cher", submission: { id: 7 } },
        }),
      );
      expect(declined).toMatchObject({
        type: "form.declined",
        receiptId: "form.declined:3",
        submissionId: "7",
        declineReason: "Trop cher",
      });
      expect(parseDocusealWebhook(JSON.stringify({ event_type: "form.viewed", data: {} }))).toEqual(
        { type: "ignored", eventType: "form.viewed" },
      );
    });
  });

  describe("traitement du webhook", () => {
    const completedEvent = (submissionId: string, externalIds: string[] = []) =>
      ({
        type: "submission.completed",
        receiptId: `submission.completed:${submissionId}`,
        submissionId,
        externalIds,
        completedAt: new Date("2026-11-02T10:00:00Z"),
      }) as const;

    const base = () => ({ db: fixture.db, crm: fixture.crm });

    it("accepte le devis en une transaction, une seule fois malgré les rejeux", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const { quote } = await sent({ companyId, opportunityId: opportunity.id });
      const event = completedEvent(quote.docusealSubmissionId ?? "");

      expect(await processDocusealWebhook(base(), event)).toBe("processed");
      expect(await processDocusealWebhook(base(), event)).toBe("duplicate");
      expect(await processDocusealWebhook(base(), event)).toBe("duplicate");

      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.quote).toMatchObject({
        status: "accepted",
        signatureStatus: "signed",
        acceptedVersionId: detail.version.id,
      });
      expect(detail.quote.signedAt?.toISOString()).toBe("2026-11-02T10:00:00.000Z");

      const [won] = await fixture.db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunity.id));
      expect(won?.stage).toBe("WON");
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toHaveLength(1);
      expect(
        await fixture.db
          .select()
          .from(domainEvents)
          .where(and(eq(domainEvents.type, "quote.accepted"), eq(domainEvents.entityId, quote.id))),
      ).toHaveLength(1);

      const receipts = await fixture.db
        .select()
        .from(webhookReceipts)
        .where(eq(webhookReceipts.externalId, event.receiptId));
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ service: "docuseal", status: "processed" });

      // Action système : le journal du devis ne l'attribue à personne.
      const audit = await fixture.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "quote.accepted"), eq(auditLog.entityId, quote.id)));
      expect(audit[0]?.actorId).toBeNull();
    });

    it("ne garde ni reçu ni effet si Twenty est coupé, et réussit au rejeu", async () => {
      const { opportunity, companyId } = await createCrmOpportunity(fixture);
      const { quote } = await sent({ companyId, opportunityId: opportunity.id });
      const event = completedEvent(quote.docusealSubmissionId ?? "");

      fixture.crm.simulateOutage();
      await expect(processDocusealWebhook(base(), event)).rejects.toBeInstanceOf(IntegrationError);
      fixture.crm.endOutage();

      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, quote.id));
      expect(row).toMatchObject({ status: "sent", signatureStatus: "pending" });
      expect(
        await fixture.db
          .select()
          .from(webhookReceipts)
          .where(eq(webhookReceipts.externalId, event.receiptId)),
      ).toEqual([]);

      expect(await processDocusealWebhook(base(), event)).toBe("processed");
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toHaveLength(1);
    });

    it("rend la main si la signature est refusée, sans clore le devis", async () => {
      const { quote, contact } = await sent();
      const outcome = await processDocusealWebhook(base(), {
        type: "form.declined",
        receiptId: `form.declined:${quote.docusealSubmissionId}`,
        submissionId: quote.docusealSubmissionId ?? "",
        externalIds: [],
        declineReason: "Trop cher",
      });
      expect(outcome).toBe("processed");
      const detail = await getQuoteDetail(fixture.viewer, quote.id);
      expect(detail.quote).toMatchObject({
        status: "sent",
        signatureStatus: "declined",
        docusealSubmissionId: null,
      });
      expect(detail.actions).toMatchObject({ requestSignature: true, refuse: true });
      expect(detail.history.some((row) => row.action === "quote.signature_declined")).toBe(true);

      // Une nouvelle demande reste possible sur la même version, sans la réenvoyer.
      const before = stub.createCalls.length;
      const again = await sendQuoteForSignature(
        fixture.member,
        quote.id,
        { signerContactId: contact.id },
        stub.deps(),
      );
      expect(again.signatureStatus).toBe("pending");
      expect(stub.createCalls).toHaveLength(before + 1);
      expect(
        await fixture.db
          .select()
          .from(domainEvents)
          .where(and(eq(domainEvents.type, "quote.sent"), eq(domainEvents.entityId, quote.id))),
      ).toHaveLength(1);
    });

    it("libère le devis quand la demande expire ou est archivée", async () => {
      for (const type of ["submission.expired", "submission.archived"] as const) {
        const { quote } = await sent();
        const submissionId = quote.docusealSubmissionId ?? "";
        expect(
          await processDocusealWebhook(base(), {
            type,
            receiptId: `${type}:${submissionId}`,
            submissionId,
            externalIds: [],
            completedAt: null,
          }),
        ).toBe("processed");
        const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, quote.id));
        expect(row).toMatchObject({
          status: "sent",
          signatureStatus: "none",
          docusealSubmissionId: null,
        });
      }
    });

    it("ignore un événement inconnu, ou sans devis", async () => {
      expect(
        await processDocusealWebhook(base(), { type: "ignored", eventType: "form.viewed" }),
      ).toBe("ignored");
      const event = completedEvent("999999");
      expect(await processDocusealWebhook(base(), event)).toBe("ignored");
      const [receipt] = await fixture.db
        .select()
        .from(webhookReceipts)
        .where(eq(webhookReceipts.externalId, event.receiptId));
      expect(receipt?.status).toBe("ignored");
    });

    it("n'accepte pas une version dépassée : la demande est archivée, la signature tracée", async () => {
      const { quote } = await sent();
      const oldSubmission = quote.docusealSubmissionId ?? "";
      const oldVersion = (await getQuoteDetail(fixture.viewer, quote.id)).version.id;
      const archivesBefore = stub.requests.filter((r) => r.method === "DELETE").length;

      await saveQuoteContent(
        fixture.member,
        quote.id,
        {
          ...content({ lines: [{ ...LINE, unitPriceCents: 900_000 }] }),
          changeNote: "Nouveau prix",
        },
        stub.deps(),
      );
      const stale = await getQuoteDetail(fixture.viewer, quote.id);
      expect(stale.quote).toMatchObject({ signatureStatus: "none", docusealSubmissionId: null });
      expect(stub.requests.filter((r) => r.method === "DELETE")).toHaveLength(archivesBefore + 1);
      expect(stub.requests.at(-1)?.path).toBe(`/submissions/${oldSubmission}`);

      const outcome = await processDocusealWebhook(
        base(),
        completedEvent(oldSubmission, [signatureExternalId(quote.id, oldVersion)]),
      );
      expect(outcome).toBe("ignored");
      const after = await getQuoteDetail(fixture.viewer, quote.id);
      expect(after.quote.status).toBe("sent");
      expect(after.history.some((row) => row.action === "quote.signature_ignored")).toBe(true);
    });

    it("ne rouvre pas un devis clos signé trop tard", async () => {
      const { quote } = await sent();
      const submissionId = quote.docusealSubmissionId ?? "";
      // Le refus libère la demande : on la rattache pour simuler une arrivée pendant ce temps.
      await refuseQuote(fixture.member, quote.id, { reason: "Non" }, stub.deps());
      await fixture.db
        .update(quotes)
        .set({ docusealSubmissionId: submissionId })
        .where(eq(quotes.id, quote.id));
      expect(await processDocusealWebhook(base(), completedEvent(submissionId))).toBe("ignored");
      const [row] = await fixture.db.select().from(quotes).where(eq(quotes.id, quote.id));
      expect(row?.status).toBe("refused");
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toEqual([]);
    });

    it("agit pour le système même si l'auteur du devis a perdu ses droits", async () => {
      const { quote } = await sent();
      await fixture.db
        .update(users)
        .set({ role: "viewer" })
        .where(eq(users.id, fixture.member.actor.userId));
      try {
        expect(
          await processDocusealWebhook(base(), completedEvent(quote.docusealSubmissionId ?? "")),
        ).toBe("processed");
      } finally {
        await fixture.db
          .update(users)
          .set({ role: "member" })
          .where(eq(users.id, fixture.member.actor.userId));
      }
    });
  });

  describe("vérification à la demande", () => {
    it("constate une signature perdue par le webhook", async () => {
      const { quote } = await sent();
      expect((await refreshQuoteSignature(fixture.member, quote.id, stub.deps())).status).toBe(
        "sent",
      );
      stub.submissionStatus = "completed";
      const refreshed = await refreshQuoteSignature(fixture.member, quote.id, stub.deps());
      expect(refreshed).toMatchObject({ status: "accepted", signatureStatus: "signed" });
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toHaveLength(1);

      // Répéter ne fait plus d'appel.
      const calls = stub.requests.length;
      await refreshQuoteSignature(fixture.member, quote.id, stub.deps());
      expect(stub.requests).toHaveLength(calls);
    });

    it("constate un refus ou une expiration, et remonte une panne", async () => {
      const declined = await sent();
      stub.submissionStatus = "declined";
      expect(
        (await refreshQuoteSignature(fixture.member, declined.quote.id, stub.deps()))
          .signatureStatus,
      ).toBe("declined");

      const expired = await sent();
      stub.submissionStatus = "expired";
      expect(
        (await refreshQuoteSignature(fixture.member, expired.quote.id, stub.deps()))
          .signatureStatus,
      ).toBe("none");

      const down = await sent();
      stub.failWith = 503;
      await expect(
        refreshQuoteSignature(fixture.member, down.quote.id, stub.deps()),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    });
  });

  describe("acceptation manuelle d'un devis en attente de signature", () => {
    it("archive la demande en cours, et un webhook tardif reste sans effet", async () => {
      const { quote } = await sent();
      const submissionId = quote.docusealSubmissionId ?? "";
      await acceptQuoteManually(
        fixture.member,
        quote.id,
        { indyReference: "PAPIER-1", signedOn: "2026-01-15" },
        stub.deps(),
      );
      expect(stub.requests.at(-1)).toMatchObject({
        method: "DELETE",
        path: `/submissions/${submissionId}`,
      });
      expect(
        await processDocusealWebhook(
          { db: fixture.db, crm: fixture.crm },
          {
            type: "submission.completed",
            receiptId: `submission.completed:${submissionId}`,
            submissionId,
            externalIds: [],
            completedAt: new Date(),
          },
        ),
      ).toBe("ignored");
      expect(
        await fixture.db.select().from(projects).where(eq(projects.quoteId, quote.id)),
      ).toHaveLength(1);
    });

    it("n'échoue pas si l'archivage chez DocuSeal échoue", async () => {
      const { quote } = await sent();
      // La panne frappe l'archivage, après l'acceptation validée.
      stub.failWith = 500;
      const result = await acceptQuoteManually(
        fixture.member,
        quote.id,
        { indyReference: "PAPIER-2", signedOn: "2026-01-15" },
        stub.deps(),
      );
      expect(result.quote.status).toBe("accepted");
    });
  });
});
