import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkN8nSignature,
  N8N_SIGNATURE_HEADER,
  N8N_TIMESTAMP_HEADER,
  N8N_TOKEN_HEADER,
  N8nClient,
  signN8nBody,
  unconfiguredN8nGateway,
} from "@/integrations/n8n/n8n.client";
import { EXPORT_DATASETS, startExport } from "@/modules/admin/export.service";
import { handleN8nWebhook } from "@/modules/platform/n8n.webhook";
import { accounts, auditLog, companies, notifications, webhookReceipts } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, ServiceUnavailableError, ValidationError } from "@/server/errors";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";
import { createCompany } from "../../helpers/factories";

let db: Database;

beforeAll(async () => {
  ({ db } = await createTestDatabase());
});

async function text(chunks: AsyncGenerator<string>): Promise<string> {
  let result = "";
  for await (const chunk of chunks) result += chunk;
  return result;
}

describe("export", () => {
  it("est réservé à export:run", async () => {
    for (const role of ["member", "viewer", "contractor", "client"] as const) {
      const ctx = await createTestContext(db, role);
      await expect(startExport(ctx, { jeu: "clients", format: "csv" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it("journalise avant la première ligne", async () => {
    const admin = await createTestContext(db, "admin");
    await startExport(admin, { jeu: "clients", format: "json" });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "export.run"));
    expect(rows.some((row) => row.actorId === admin.actor.userId)).toBe(true);
    expect(rows.at(-1)?.metadata).toMatchObject({ dataset: "clients", format: "json" });
  });

  it("CSV : une formule est neutralisée, un nombre négatif reste un nombre", async () => {
    const admin = await createTestContext(db, "admin");
    await createCompany(db, { name: '=HYPERLINK("http://exemple.test")' });
    const exported = await startExport(admin, { jeu: "clients", format: "csv" });
    expect(exported.contentType).toContain("text/csv");
    expect(exported.filename).toMatch(/^nuera-clients-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await text(exported.chunks);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`"'=HYPERLINK(""http://exemple.test"")"`);
    expect(csv).not.toContain(";=HYPERLINK");
  });

  it("n'exporte ni mot de passe, ni jeton, ni secret, ni boîte d'envoi", async () => {
    const admin = await createTestContext(db, "admin");
    await db.insert(accounts).values({
      accountId: "x",
      providerId: "credential",
      userId: admin.actor.userId,
      password: "EMPREINTE-SECRETE",
      accessToken: "JETON-SECRET",
    });
    const exported = await startExport(admin, { jeu: "tout", format: "csv" });
    // L'export complet est toujours en JSON, valide.
    expect(exported.filename).toMatch(/\.json$/);
    const raw = await text(exported.chunks);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(raw).not.toContain("EMPREINTE-SECRETE");
    expect(raw).not.toContain("JETON-SECRET");
    expect(raw).not.toMatch(/"password"|"accessToken"|"backupCodes"|"storageKey"/);
    expect(parsed).not.toHaveProperty("accounts");
    expect(parsed).not.toHaveProperty("sessions");
    expect(parsed).toHaveProperty("comptes");
    expect((parsed.comptes as Record<string, unknown>[])[0]).toHaveProperty("email");
    for (const dataset of EXPORT_DATASETS) expect(parsed).toHaveProperty(dataset.key);
  });

  it("lit par lots : un gros jeu sort entier et trié", async () => {
    const admin = await createTestContext(db, "admin");
    const { db: fresh } = await createTestDatabase();
    const ctx = { ...admin, db: fresh };
    await fresh.insert((await import("@/server/db/schema")).users).values({
      id: admin.actor.userId,
      name: admin.actor.name,
      email: admin.actor.email,
      role: "admin",
    });
    const total = 1_203;
    await fresh.insert(companies).values(
      Array.from({ length: total }, (_, index) => ({
        twentyId: `lot-${index}`,
        name: `Client ${index}`,
      })),
    );
    const json = JSON.parse(
      await text((await startExport(ctx, { jeu: "clients", format: "json" })).chunks),
    ) as { id: string }[];
    expect(json).toHaveLength(total);
    expect(new Set(json.map((row) => row.id)).size).toBe(total);
  });

  it("refuse un jeu ou un format inconnu", async () => {
    const admin = await createTestContext(db, "admin");
    await expect(startExport(admin, { jeu: "accounts", format: "csv" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(startExport(admin, { jeu: "clients", format: "xml" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("n8n, signature", () => {
  const secret = "s".repeat(32);
  const body = '{"id":"1"}';
  const now = new Date("2030-01-01T10:00:00Z");
  const timestamp = String(now.getTime());
  const signature = signN8nBody(secret, timestamp, body);

  it("accepte une signature juste et récente", () => {
    expect(checkN8nSignature({ secret, body, signature, timestamp, now })).toBe(true);
  });

  it("refuse un corps modifié, un autre secret, ou un enregistrement ancien", () => {
    expect(checkN8nSignature({ secret, body: '{"id":"2"}', signature, timestamp, now })).toBe(
      false,
    );
    expect(checkN8nSignature({ secret: "t".repeat(32), body, signature, timestamp, now })).toBe(
      false,
    );
    expect(
      checkN8nSignature({
        secret,
        body,
        signature,
        timestamp,
        now: new Date(now.getTime() + 6 * 60_000),
      }),
    ).toBe(false);
    expect(checkN8nSignature({ secret, body, signature: null, timestamp, now })).toBe(false);
    expect(checkN8nSignature({ secret, body, signature: "x", timestamp, now })).toBe(false);
    expect(checkN8nSignature({ secret, body, signature, timestamp: "abc", now })).toBe(false);
  });
});

describe("webhook n8n entrant", () => {
  it("prévient la direction, une seule fois, avec un lien interne seulement", async () => {
    const { db: fresh } = await createTestDatabase();
    const admin = await createTestActor(fresh, "admin");
    const member = await createTestActor(fresh, "member");
    const payload = {
      id: "envoi-1",
      title: "Scénario terminé",
      href: "/sites",
      severity: "warning",
    };
    expect(await handleN8nWebhook(fresh, payload)).toBe("applied");
    expect(await handleN8nWebhook(fresh, payload)).toBe("duplicate");
    const rows = await fresh
      .select()
      .from(notifications)
      .where(eq(notifications.userId, admin.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ href: "/sites", severity: "warning" });
    expect(
      await fresh.select().from(notifications).where(eq(notifications.userId, member.userId)),
    ).toHaveLength(0);
    expect(await fresh.select().from(webhookReceipts)).toHaveLength(1);
  });

  it("refuse un corps invalide ou un lien externe", async () => {
    expect(await handleN8nWebhook(db, { title: "Sans id" })).toBe("invalid");
    expect(await handleN8nWebhook(db, { id: "x", title: "t", href: "//exemple.test" })).toBe(
      "invalid",
    );
    expect(await handleN8nWebhook(db, { id: "x", title: "t", href: "https://exemple.test" })).toBe(
      "invalid",
    );
  });
});

describe("N8nClient, contre un serveur HTTP local", () => {
  let server: Server;
  let url: string;
  let respond = 200;
  const received: { headers: Record<string, unknown>; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        res.statusCode = respond;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook/test`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const secret = "s".repeat(32);
  const event = {
    id: "e",
    type: "quote.accepted",
    entityType: "quote",
    entityId: "q",
    companyId: null,
    occurredAt: "2030-01-01T00:00:00.000Z",
    payload: {},
  };

  it("poste un corps signé, vérifiable, avec l'en-tête Header Auth", async () => {
    await new N8nClient({ url, secret, headerToken: "jeton-header-auth" }).send(event);
    const last = received.at(-1);
    expect(last?.headers[N8N_TOKEN_HEADER]).toBe("jeton-header-auth");
    expect(
      checkN8nSignature({
        secret,
        body: last?.body ?? "",
        signature: last?.headers[N8N_SIGNATURE_HEADER] as string,
        timestamp: last?.headers[N8N_TIMESTAMP_HEADER] as string,
      }),
    ).toBe(true);
  });

  it("une erreur devient ServiceUnavailableError, jamais un succès", async () => {
    respond = 404;
    await expect(new N8nClient({ url, secret }).send(event)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    respond = 401;
    await expect(new N8nClient({ url, secret }).send(event)).rejects.toMatchObject({
      reason: "unauthorized",
    });
    respond = 200;
    await expect(
      new N8nClient({ url: "http://127.0.0.1:1/x", secret }).send(event),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(unconfiguredN8nGateway.send(event)).rejects.toMatchObject({
      reason: "not_configured",
    });
  });
});
