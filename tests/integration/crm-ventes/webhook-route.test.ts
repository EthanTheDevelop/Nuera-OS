import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { respondToTwentyWebhook } from "@/modules/crm/crm.webhook";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";
import { FakeCrmGateway } from "../../helpers/fake-crm-gateway";
import { uuid } from "./world";

const SECRET = "s".repeat(64);

let db: Database;
let close: () => Promise<void>;
let crm: FakeCrmGateway;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(() => {
  crm = new FakeCrmGateway();
});

function signedHeaders(rawBody: string, options: { secret?: string; nonce?: string } = {}) {
  const timestamp = String(Date.now());
  return new Headers({
    "x-twenty-webhook-signature": createHmac("sha256", options.secret ?? SECRET)
      .update(`${timestamp}:${rawBody}`)
      .digest("hex"),
    "x-twenty-webhook-timestamp": timestamp,
    "x-twenty-webhook-nonce": options.nonce ?? randomBytes(16).toString("hex"),
  });
}

function companyEvent(id: string, name: string) {
  const now = new Date().toISOString();
  return JSON.stringify({
    eventName: "company.created",
    objectMetadata: { id: uuid(), nameSingular: "company" },
    workspaceId: uuid(),
    webhookId: uuid(),
    eventDate: now,
    targetUrl: "https://example.test/hook",
    updatedFields: [],
    record: {
      id,
      name,
      domainName: { primaryLinkUrl: "", primaryLinkLabel: "", secondaryLinks: [] },
      address: {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  });
}

async function countCompanies(twentyId: string) {
  const rows = await db.select().from(s.companies).where(eq(s.companies.twentyId, twentyId));
  return rows.length;
}

describe("réponse HTTP du webhook Twenty", () => {
  it("sans secret configuré, la route n'existe pas et rien n'est écrit", async () => {
    const twentyId = uuid();
    const rawBody = companyEvent(twentyId, "Sans secret");
    const response = await respondToTwentyWebhook(
      { db, crm },
      { rawBody, headers: signedHeaders(rawBody), secret: undefined },
    );
    expect(response.status).toBe(404);
    expect(await countCompanies(twentyId)).toBe(0);
  });

  it("une signature fausse ou absente répond 401 sans rien écrire", async () => {
    const twentyId = uuid();
    const rawBody = companyEvent(twentyId, "Signature fausse");
    const forged = await respondToTwentyWebhook(
      { db, crm },
      { rawBody, headers: signedHeaders(rawBody, { secret: "x".repeat(64) }), secret: SECRET },
    );
    expect(forged.status).toBe(401);
    const unsigned = await respondToTwentyWebhook(
      { db, crm },
      { rawBody, headers: new Headers(), secret: SECRET },
    );
    expect(unsigned.status).toBe(401);
    expect(await countCompanies(twentyId)).toBe(0);
  });

  it("la signature porte sur le corps brut : un octet changé est refusé", async () => {
    const twentyId = uuid();
    const rawBody = companyEvent(twentyId, "Corps brut");
    const response = await respondToTwentyWebhook(
      { db, crm },
      { rawBody: `${rawBody} `, headers: signedHeaders(rawBody), secret: SECRET },
    );
    expect(response.status).toBe(401);
    expect(await countCompanies(twentyId)).toBe(0);
  });

  it("un corps signé mais illisible répond 400, un corps trop lourd 413", async () => {
    const invalid = await respondToTwentyWebhook(
      { db, crm },
      { rawBody: "pas du json", headers: signedHeaders("pas du json"), secret: SECRET },
    );
    expect(invalid.status).toBe(400);
    const heavy = "x".repeat(1_000_001);
    const tooLarge = await respondToTwentyWebhook(
      { db, crm },
      { rawBody: heavy, headers: signedHeaders(heavy), secret: SECRET },
    );
    expect(tooLarge.status).toBe(413);
  });

  it("une livraison valide met à jour la projection, sa répétition ne fait rien", async () => {
    const twentyId = uuid();
    const rawBody = companyEvent(twentyId, "Livraison valide");
    const nonce = randomBytes(16).toString("hex");
    const first = await respondToTwentyWebhook(
      { db, crm },
      { rawBody, headers: signedHeaders(rawBody, { nonce }), secret: SECRET },
    );
    expect(first).toEqual({ status: 200, body: { outcome: "processed" } });
    expect(await countCompanies(twentyId)).toBe(1);

    const replay = await respondToTwentyWebhook(
      { db, crm },
      { rawBody, headers: signedHeaders(rawBody, { nonce }), secret: SECRET },
    );
    expect(replay).toEqual({ status: 200, body: { outcome: "duplicate" } });
    expect(await countCompanies(twentyId)).toBe(1);
  });
});
