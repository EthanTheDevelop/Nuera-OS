/**
 * Tests sur une instance Twenty réelle : `npm run test:live` (jamais dans `npm test` ni la CI).
 * Prérequis : `docker compose -f docker-compose.twenty.yml --env-file .env up -d` puis
 * `npm run twenty:bootstrap`. Tout ce qui est créé ici est supprimé définitivement à la fin.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeCrmGatewayContract } from "../helpers/crm-gateway.contract";

process.loadEnvFile(".env");

const { getCrmGateway } = await import("@/integrations/twenty");
const { TwentyClient } = await import("@/integrations/twenty/twenty.client");
const { TwentyCrmGateway } = await import("@/integrations/twenty/twenty.gateway");
const { receiveTwentyWebhook, TwentyWebhookRejectedError } =
  await import("@/integrations/twenty/twenty.webhook");
const { NUERA_STAGES } = await import("@/integrations/twenty/twenty.data-model");
const { IntegrationUnavailableError } = await import("@/integrations/twenty/crm-gateway");

const baseUrl = process.env.TWENTY_API_URL;
const apiKey = process.env.TWENTY_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error("TWENTY_API_URL / TWENTY_API_KEY absents : lancer `npm run twenty:bootstrap`.");
}

const admin = new TwentyClient({ baseUrl, apiKey, timeoutMs: 30_000 });
const REST_PATH = {
  company: "companies",
  person: "people",
  opportunity: "opportunities",
  note: "notes",
  task: "tasks",
} as const;
const tracked: { kind: keyof typeof REST_PATH; id: string }[] = [];
const track = (kind: keyof typeof REST_PATH, id: string) => {
  tracked.push({ kind, id });
};

/** Suppression définitive : DELETE sans `soft_delete`, y compris pour une fiche déjà archivée. */
async function purge(): Promise<void> {
  for (const { kind, id } of tracked.reverse()) {
    await admin
      .request({ method: "DELETE", path: `/rest/${REST_PATH[kind]}/${id}` })
      .catch(() => undefined);
  }
}

afterAll(purge);

describeCrmGatewayContract("Twenty réel", () => ({ gateway: getCrmGateway(), track }));

describe("instance Twenty réelle", () => {
  it("version figée et étapes Nuera appliquées", async () => {
    expect((await getCrmGateway().health()).version).toBe("v2.55.0");

    const body = (await admin.request({
      method: "GET",
      path: "/rest/metadata/objects",
      query: { limit: 200 },
    })) as { data: { nameSingular: string; fields: { name: string; options?: unknown }[] }[] };
    const stage = body.data
      .find((object) => object.nameSingular === "opportunity")
      ?.fields.find((field) => field.name === "stage");
    expect(stage?.options).toEqual(
      NUERA_STAGES.map((option, position) =>
        expect.objectContaining({ value: option.value, label: option.label, position }),
      ),
    );
  });

  it("n'ajoute aucun champ personnalisé à Twenty", async () => {
    const body = (await admin.request({
      method: "GET",
      path: "/rest/metadata/objects",
      query: { limit: 200 },
    })) as {
      data: { nameSingular: string; fields: { name: string; isCustom?: boolean }[] }[];
    };
    for (const name of ["company", "person", "opportunity", "note", "task"]) {
      const object = body.data.find((candidate) => candidate.nameSingular === name);
      expect(object?.fields.filter((field) => field.isCustom)).toEqual([]);
    }
  });

  it("refuse une clé invalide avec une erreur typée et le signale dans health()", async () => {
    const gateway = new TwentyCrmGateway(
      new TwentyClient({ baseUrl: baseUrl!, apiKey: "cle-invalide", maxRetries: 0 }),
    );
    await expect(gateway.listCompanies()).rejects.toMatchObject({ reason: "unauthorized" });
    await expect(gateway.health()).resolves.toMatchObject({
      reachable: true,
      authenticated: false,
    });
  });

  it("signale une instance injoignable", async () => {
    const gateway = new TwentyCrmGateway(
      new TwentyClient({
        baseUrl: "http://127.0.0.1:9",
        apiKey: "x",
        maxRetries: 0,
        timeoutMs: 1_000,
      }),
    );
    await expect(gateway.getCompany("x")).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(gateway.health()).resolves.toEqual({
      reachable: false,
      authenticated: false,
      version: null,
    });
  });
});

describe("webhook réel", () => {
  const secret = randomBytes(32).toString("hex");
  const deliveries: { rawBody: Buffer; headers: Record<string, string | string[] | undefined> }[] =
    [];
  let server: Server;
  let webhookId: string;

  const adminGraphql = async <T>(query: string): Promise<T> => {
    const response = await fetch(`${baseUrl}/metadata`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query }),
    });
    return ((await response.json()) as { data: T }).data;
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        deliveries.push({ rawBody: Buffer.concat(chunks), headers: request.headers });
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
    const { port } = server.address() as AddressInfo;

    const { getApiKeyRoles } = await adminGraphql<{
      getApiKeyRoles: { id: string; label: string }[];
    }>("query { getApiKeyRoles { id label } }");
    const created = (await admin.request({
      method: "POST",
      path: "/rest/metadata/webhooks",
      body: {
        targetUrl: `http://host.docker.internal:${port}/hook`,
        operations: ["company.*", "note.*", "noteTarget.*"],
        description: "test:live (temporaire)",
        secret,
        roleId: getApiKeyRoles.find((role) => role.label === "Admin")?.id,
      },
    })) as { id: string };
    webhookId = created.id;
  });

  afterAll(async () => {
    server.close();
    await admin
      .request({ method: "DELETE", path: `/rest/metadata/webhooks/${webhookId}` })
      .catch(() => undefined);
  });

  it("vérifie la signature d'une livraison réelle puis l'interprète", async () => {
    const crm = getCrmGateway();
    const tag = Date.now();
    const company = await crm.createCompany({
      name: `Webhook Évènement ${tag}`,
      domains: { primary: `wh-${tag}.example`, additional: [] },
    });
    track("company", company.id);
    await crm.updateCompany(company.id, { name: `Webhook Évènement ${tag} bis` });
    const note = await crm.createNote({
      title: `Webhook ${tag}`,
      bodyMarkdown: "Texte",
      targets: [{ type: "company", id: company.id }],
    });
    track("note", note.id);
    await crm.deleteCompany(company.id);

    const wanted = ["company.created", "company.updated", "company.deleted", "note.created"];
    const received = () =>
      deliveries.map((delivery) => {
        const { event, nonce } = receiveTwentyWebhook({ ...delivery, secret });
        return { event, nonce };
      });

    const deadline = Date.now() + 60_000;
    let events = received();
    while (
      Date.now() < deadline &&
      !(
        wanted.every((name) => events.some(({ event }) => event.eventName === name)) &&
        events.some(({ event }) => event.entity === "activityLink")
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      events = received();
    }

    const find = (name: string) =>
      events.find(({ event }) => event.eventName === name && event.recordId === company.id)?.event;

    const createdEvent = find("company.created");
    expect(createdEvent).toMatchObject({
      entity: "company",
      action: "created",
      recordId: company.id,
      record: {
        name: `Webhook Évènement ${tag}`,
        domains: { primary: `wh-${tag}.example`, additional: [] },
      },
    });
    expect(find("company.updated")).toMatchObject({
      updatedFields: ["name"],
      record: { name: `Webhook Évènement ${tag} bis` },
    });
    expect(find("company.deleted")?.record).toMatchObject({
      deletedAt: expect.any(String),
    });

    const link = events.find(({ event }) => event.entity === "activityLink")?.event;
    expect(link).toMatchObject({
      entity: "activityLink",
      action: "created",
      record: {
        activityType: "note",
        activityId: note.id,
        target: { type: "company", id: company.id },
      },
    });
    expect(events.every(({ nonce }) => /^[0-9a-f]{32}$/.test(nonce ?? ""))).toBe(true);

    // La même livraison est refusée si le corps ou le secret change, ou si elle est trop ancienne.
    const sample = deliveries[0]!;
    expect(() =>
      receiveTwentyWebhook({
        ...sample,
        rawBody: Buffer.concat([sample.rawBody, Buffer.from(" ")]),
        secret,
      }),
    ).toThrow(TwentyWebhookRejectedError);
    expect(() => receiveTwentyWebhook({ ...sample, secret: "autre-secret" })).toThrow(
      TwentyWebhookRejectedError,
    );
    expect(() =>
      receiveTwentyWebhook({ ...sample, secret, nowMs: Date.now() + 60 * 60 * 1000 }),
    ).toThrow(TwentyWebhookRejectedError);
  });
});
