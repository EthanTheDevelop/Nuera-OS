import { describe, expect, it, vi } from "vitest";
import { TwentyApiError, TwentyClient, TwentyNetworkError } from "./twenty.client";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function setup(responses: (Response | Error)[]) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("Plus de réponse préparée");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => undefined);
  const client = new TwentyClient({
    baseUrl: "https://crm.example/",
    apiKey: "cle-secrete",
    fetch: fetchMock,
    sleep,
    baseDelayMs: 100,
  });
  return { client, fetchMock, sleep };
}

describe("TwentyClient", () => {
  it("envoie la clé, encode la requête et renvoie le corps", async () => {
    const { client, fetchMock } = setup([json(200, { data: 1 })]);
    await expect(
      client.request({
        method: "GET",
        path: "/rest/companies",
        query: { limit: 2, filter: 'updatedAt[gte]:"2026-01-01"', cursor: undefined },
      }),
    ).resolves.toEqual({ data: 1 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://crm.example/rest/companies?limit=2&filter=updatedAt%5Bgte%5D%3A%222026-01-01%22",
    );
    expect(init?.headers).toMatchObject({ authorization: "Bearer cle-secrete" });
  });

  it("rejoue un GET sur 5xx puis réussit", async () => {
    const { client, sleep, fetchMock } = setup([
      json(503, {}),
      json(502, {}),
      json(200, { ok: 1 }),
    ]);
    await expect(client.request({ method: "GET", path: "/x" })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[1]![0]).toBeGreaterThanOrEqual(sleep.mock.calls[0]![0] / 2);
  });

  it("rejoue une erreur réseau sur requête idempotente et la signale après épuisement", async () => {
    const { client, fetchMock } = setup([
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
    ]);
    const error = await client.request({ method: "PATCH", path: "/x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TwentyNetworkError);
    expect(error).toMatchObject({ attempts: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("ne rejoue jamais un POST non idempotent sur 5xx ou erreur réseau", async () => {
    const failing = setup([json(500, {})]);
    await expect(
      failing.client.request({ method: "POST", path: "/x", body: {} }),
    ).rejects.toBeInstanceOf(TwentyApiError);
    expect(failing.fetchMock).toHaveBeenCalledTimes(1);

    const network = setup([new Error("ECONNRESET")]);
    await expect(
      network.client.request({ method: "POST", path: "/x", body: {} }),
    ).rejects.toBeInstanceOf(TwentyNetworkError);
    expect(network.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne rejoue pas un PATCH marqué non idempotent (fusion)", async () => {
    const { client, fetchMock } = setup([json(503, {})]);
    await expect(
      client.request({ method: "PATCH", path: "/x", idempotent: false }),
    ).rejects.toBeInstanceOf(TwentyApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejoue un POST marqué idempotent", async () => {
    const { client, fetchMock } = setup([json(500, {}), json(201, { ok: 1 })]);
    await client.request({ method: "POST", path: "/x", body: {}, idempotent: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejoue tout sur 429 (rien n'a été traité) en respectant Retry-After", async () => {
    const { client, sleep } = setup([
      json(429, { error: "RATE_LIMITED" }, { "retry-after": "2" }),
      json(201, { ok: 1 }),
    ]);
    await client.request({ method: "POST", path: "/x", body: {} });
    expect(sleep.mock.calls[0]![0]).toBeGreaterThanOrEqual(2000);
  });

  it("n'attend pas au-delà du plafond et expose le délai demandé", async () => {
    const { client, fetchMock } = setup([json(429, {}, { "retry-after": "30" })]);
    const error = await client.request({ method: "GET", path: "/x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TwentyApiError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 30_000, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne rejoue pas une erreur 4xx et expose les messages techniques", async () => {
    const { client, fetchMock } = setup([
      json(400, { messages: ["bad"], error: "BadRequestException" }),
    ]);
    const error = await client.request({ method: "GET", path: "/x" }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 400,
      messages: ["bad"],
      twentyCode: "BadRequestException",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("signale un corps illisible malgré un statut 200 (proxy, page d'erreur)", async () => {
    const { client } = setup([new Response("<html>", { status: 200 })]);
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toThrow(/illisible/);
  });

  it("ne révèle jamais la clé dans une erreur ou un message utilisateur", async () => {
    const { client } = setup([json(401, { messages: ["Token invalid."] })]);
    const error = (await client
      .request({ method: "GET", path: "/x" })
      .catch((e: unknown) => e)) as Error;
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain("cle-secrete");
    expect(error.message).toMatch(/CRM/);
  });

  it("n'inscrit ni la clé ni les paramètres de requête dans les journaux", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    try {
      const { client } = setup([json(503, {}), json(200, {})]);
      await client.request({
        method: "GET",
        path: "/rest/people",
        query: { filter: "emails.primaryEmail[eq]:personne@example.com" },
      });
      const written = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(written).toContain("twenty.request_retry");
      expect(written).toContain("/rest/people");
      expect(written).not.toContain("personne@example.com");
      expect(written).not.toContain("cle-secrete");
    } finally {
      process.env.LOG_LEVEL = previous;
      stderr.mockRestore();
    }
  });
});
