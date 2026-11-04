import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendQuoteForSignature } from "@/modules/quotes/quote-signature.service";
import { createQuote, saveQuoteContent } from "@/modules/quotes/quote.service";
import { handleDocusealWebhookRequest } from "@/modules/quotes/quote.webhook";
import { projects, quotes, webhookReceipts } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";
import { createContact } from "../../helpers/factories";
import {
  content,
  createCrmOpportunity,
  createFixture,
  DocusealStub,
  type Fixture,
} from "./helpers";

const SECRET = "whsec_secret_de_test_0123456789";

const runtime = vi.hoisted(() => ({
  secret: null as string | null,
  db: null as unknown,
  crm: null as unknown,
}));

vi.mock("@/integrations/docuseal", () => ({
  getDocusealWebhookSecret: () => runtime.secret,
}));
vi.mock("@/integrations/twenty", () => ({ getCrmGateway: () => runtime.crm }));
vi.mock("@/server/db/client", () => ({ getDb: () => runtime.db }));

function signedHeaders(rawBody: string, secret = SECRET): Headers {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return new Headers({ "x-docuseal-signature": `${timestamp}.${digest}` });
}

/** Le chemin de la route : corps brut et en-têtes, jusqu'à la base. */
describe("route du webhook DocuSeal", () => {
  let close: () => Promise<void>;
  let db: Database;
  let fixture: Fixture;
  const stub = new DocusealStub();

  beforeAll(async () => {
    const database = await createTestDatabase();
    close = database.close;
    db = database.db;
    fixture = await createFixture(database.db);
    runtime.db = fixture.db;
    runtime.crm = fixture.crm;
    await stub.start();
  });
  afterAll(async () => {
    await stub.stop();
    await close();
  });
  beforeEach(() => {
    runtime.secret = SECRET;
    fixture.crm.endOutage();
  });

  async function sentQuote() {
    const { opportunity, companyId } = await createCrmOpportunity(fixture);
    const contact = await createContact(fixture.db, {
      companyId,
      email: `route-${Math.random().toString(36).slice(2)}@test.local`,
    });
    const quote = await createQuote(fixture.member, {
      companyId,
      opportunityId: opportunity.id,
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

  const completedBody = (submissionId: string | null) =>
    JSON.stringify({
      event_type: "submission.completed",
      timestamp: "2026-11-02T10:00:00Z",
      data: { id: Number(submissionId), completed_at: "2026-11-02T10:00:00Z", submitters: [] },
    });

  it("répond 503 sans secret configuré, sans rien lire", async () => {
    runtime.secret = null;
    const response = await handleDocusealWebhookRequest("{}", new Headers());
    expect(response.status).toBe(503);
  });

  it("répond 401 sans signature, ou signée avec un autre secret", async () => {
    const quote = await sentQuote();
    const body = completedBody(quote.docusealSubmissionId);
    expect((await handleDocusealWebhookRequest(body, new Headers())).status).toBe(401);
    const forged = signedHeaders(body, "whsec_un_autre_secret_0123456789");
    expect((await handleDocusealWebhookRequest(body, forged)).status).toBe(401);

    const [row] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row?.status).toBe("sent");
  });

  it("répond 400 à un corps signé mais illisible", async () => {
    const body = "pas du JSON";
    expect((await handleDocusealWebhookRequest(body, signedHeaders(body))).status).toBe(400);
  });

  it("accuse réception d'un événement sans effet sur un devis", async () => {
    const body = JSON.stringify({ event_type: "form.viewed", data: {} });
    const response = await handleDocusealWebhookRequest(body, signedHeaders(body));
    expect(response).toEqual({ status: 200, body: { outcome: "ignored" } });
  });

  it("accepte le devis une seule fois malgré un rejeu", async () => {
    const quote = await sentQuote();
    const body = completedBody(quote.docusealSubmissionId);

    const first = await handleDocusealWebhookRequest(body, signedHeaders(body));
    expect(first).toEqual({ status: 200, body: { outcome: "processed" } });
    const replay = await handleDocusealWebhookRequest(body, signedHeaders(body));
    expect(replay).toEqual({ status: 200, body: { outcome: "duplicate" } });

    const [row] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
    expect(row).toMatchObject({ status: "accepted", signatureStatus: "signed" });
    expect(await db.select().from(projects).where(eq(projects.quoteId, quote.id))).toHaveLength(1);
  });

  it("répond 503 si le traitement échoue, sans garder de reçu, pour que DocuSeal rejoue", async () => {
    const quote = await sentQuote();
    const body = completedBody(quote.docusealSubmissionId);

    fixture.crm.simulateOutage();
    const failed = await handleDocusealWebhookRequest(body, signedHeaders(body));
    expect(failed.status).toBe(503);
    expect(failed.body.error).not.toContain(SECRET);
    expect(
      await db
        .select()
        .from(webhookReceipts)
        .where(
          eq(webhookReceipts.externalId, `submission.completed:${quote.docusealSubmissionId}`),
        ),
    ).toEqual([]);

    fixture.crm.endOutage();
    const replay = await handleDocusealWebhookRequest(body, signedHeaders(body));
    expect(replay).toEqual({ status: 200, body: { outcome: "processed" } });
  });
});
