import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/server/errors";
import { CrmDuplicateError, IntegrationUnavailableError } from "./crm-gateway";
import { getCrmGateway } from "./index";
import { TwentyApiError, TwentyClient, TwentyNetworkError } from "./twenty.client";
import { translateTwentyError, TwentyCrmGateway } from "./twenty.gateway";

type Route = (url: URL, init: RequestInit | undefined) => Response;

function gatewayWith(route: Route) {
  const calls: { method: string; url: URL; body: unknown }[] = [];
  const client = new TwentyClient({
    baseUrl: "https://crm.example",
    apiKey: "cle",
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method ?? "GET",
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return route(url, init);
    },
  });
  return { gateway: new TwentyCrmGateway(client), calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const companyRecord = {
  id: "c1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  name: "Acme",
  domainName: {
    primaryLinkUrl: "acme.fr",
    primaryLinkLabel: "",
    secondaryLinks: [{ url: "acme.com", label: "" }],
  },
  linkedinLink: { primaryLinkUrl: "", secondaryLinks: [] },
  address: { addressCity: "Lyon", addressStreet1: "" },
};

const opportunityRecord = {
  id: "o1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  name: "Refonte",
  stage: "QUOTE_SENT",
  amount: { amountMicros: 12_345_670_000, currencyCode: "EUR" },
  closeDate: "2027-03-15T00:00:00.000Z",
  companyId: "c1",
  pointOfContactId: null,
};

describe("TwentyCrmGateway : correspondance avec l'API", () => {
  it("traduit les formes de Twenty vers le vocabulaire Nuera", async () => {
    const { gateway } = gatewayWith(() => json(200, { data: { company: companyRecord } }));
    await expect(gateway.getCompany("c1")).resolves.toEqual({
      id: "c1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      name: "Acme",
      domains: { primary: "acme.fr", additional: ["acme.com"] },
      linkedinUrl: null,
      address: {
        street1: null,
        street2: null,
        city: "Lyon",
        postcode: null,
        state: null,
        country: null,
      },
    });
  });

  it("convertit les centimes en micros à l'écriture et inversement à la lecture", async () => {
    const { gateway, calls } = gatewayWith(() =>
      json(201, { data: { createOpportunity: opportunityRecord } }),
    );
    const opportunity = await gateway.createOpportunity({
      name: "Refonte",
      stage: "QUOTE_SENT",
      amount: { cents: 1_234_567, currency: "EUR" },
      closeDate: "2027-03-15",
    });
    expect(calls[0]?.body).toMatchObject({
      amount: { amountMicros: 12_345_670_000, currencyCode: "EUR" },
      closeDate: "2027-03-15T00:00:00.000Z",
      stage: "QUOTE_SENT",
    });
    expect(opportunity).toMatchObject({
      amount: { cents: 1_234_567, currency: "EUR" },
      closeDate: "2027-03-15",
    });
  });

  it("génère l'identifiant de création et marque le POST rejouable", async () => {
    const { gateway, calls } = gatewayWith(() =>
      json(201, { data: { createCompany: companyRecord } }),
    );
    await gateway.createCompany({ name: "Acme" });
    expect((calls[0]?.body as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("archive toujours avec soft_delete=true : sans lui, DELETE est définitif", async () => {
    const { gateway, calls } = gatewayWith(() =>
      json(200, { data: { deleteCompany: { id: "c1" } } }),
    );
    await gateway.deleteCompany("c1");
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    expect(calls[0]?.url.pathname).toBe("/rest/companies/c1");
    expect(calls[0]?.url.searchParams.get("soft_delete")).toBe("true");
  });

  it("trie par updatedAt puis id, plafonne à 200 et combine les filtres", async () => {
    const { gateway, calls } = gatewayWith(() =>
      json(200, {
        data: { companies: [] },
        pageInfo: { endCursor: "curseur", hasNextPage: true },
      }),
    );
    const page = await gateway.listCompanies({
      updatedSince: "2026-01-01T00:00:00Z",
      cursor: "avant",
      limit: 500,
      includeDeleted: true,
    });
    const params = calls[0]?.url.searchParams;
    expect(params?.get("order_by")).toBe("updatedAt[AscNullsLast],id[AscNullsLast]");
    expect(params?.get("limit")).toBe("200");
    expect(params?.get("starting_after")).toBe("avant");
    expect(params?.get("filter")).toBe(
      'and(updatedAt[gte]:"2026-01-01T00:00:00.000Z",or(deletedAt[is]:NULL,deletedAt[is]:NOT_NULL))',
    );
    expect(page.nextCursor).toBe("curseur");
  });

  it("n'expose pas de curseur sur la dernière page et refuse une date de reprise invalide", async () => {
    const { gateway } = gatewayWith(() =>
      json(200, { data: { companies: [] }, pageInfo: { endCursor: "x", hasNextPage: false } }),
    );
    await expect(gateway.listCompanies()).resolves.toEqual({ items: [], nextCursor: null });
    await expect(gateway.listCompanies({ updatedSince: "hier" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("échappe l'identifiant dans le chemin", async () => {
    const { gateway, calls } = gatewayWith(() => json(404, { messages: [] }));
    await gateway.getCompany("../webhooks").catch(() => undefined);
    expect(calls[0]?.url.pathname).toBe("/rest/companies/..%2Fwebhooks");
  });

  it("annule la note créée si ses liens échouent, sans orpheline", async () => {
    const { gateway, calls } = gatewayWith((url, init) => {
      if (url.pathname === "/rest/notes" && init?.method === "POST") {
        return json(201, {
          data: {
            createNote: {
              id: "n1",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              title: "Note",
            },
          },
        });
      }
      if (url.pathname === "/rest/batch/noteTargets") {
        return json(400, { messages: ['violates foreign key constraint "FK"'] });
      }
      return json(200, { data: { deleteNote: { id: "n1" } } });
    });
    await expect(
      gateway.createNote({ title: "Note", targets: [{ type: "company", id: "c1" }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const purge = calls.at(-1);
    expect(purge?.method).toBe("DELETE");
    expect(purge?.url.searchParams.has("soft_delete")).toBe(false);
  });

  it("identifie la fiche existante en cas de doublon", async () => {
    const { gateway, calls } = gatewayWith((url) =>
      url.pathname === "/rest/companies" && !url.searchParams.has("filter")
        ? json(400, {
            messages: [
              "A duplicate entry was detected: unique constraint company.IDX_UNIQUE_abc was violated",
            ],
          })
        : json(200, {
            data: { companies: [{ id: "existante", deletedAt: "2026-01-01T00:00:00.000Z" }] },
          }),
    );
    const error = await gateway
      .createCompany({ name: "x", domains: { primary: "https://www.Acme.fr/", additional: [] } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CrmDuplicateError);
    expect(error).toMatchObject({ field: "domain", existing: { id: "existante", deleted: true } });
    expect((error as Error).message).toContain("archivée");
    expect(calls[1]?.url.searchParams.get("filter")).toContain(
      'domainName.primaryLinkUrl[eq]:"acme.fr"',
    );
  });

  it("garde le doublon typé même si la recherche de la fiche échoue", async () => {
    const { gateway } = gatewayWith((url) =>
      url.searchParams.has("filter")
        ? json(500, {})
        : json(400, { messages: ["unique constraint person.IDX_UNIQUE_x was violated"] }),
    );
    await expect(
      gateway.createPerson({
        firstName: "a",
        lastName: "b",
        emails: { primary: "A@B.fr", additional: [] },
      }),
    ).rejects.toMatchObject({ field: "email", existing: null });
  });

  it("refuse une étape inconnue à la lecture (configuration non appliquée)", async () => {
    const { gateway } = gatewayWith(() =>
      json(200, { data: { opportunity: { ...opportunityRecord, stage: "SCREENING" } } }),
    );
    await expect(gateway.getOpportunity("o1")).rejects.toThrow(/twenty:bootstrap/);
  });

  it("signale une réponse inattendue au lieu d'inventer des données", async () => {
    const { gateway } = gatewayWith(() => json(200, { data: { company: { name: "sans id" } } }));
    await expect(gateway.getCompany("c1")).rejects.toThrow(/Réponse inattendue/);
  });

  it("décrit l'état de santé sans lever d'erreur", async () => {
    const ok = gatewayWith((url) => {
      if (url.pathname === "/healthz") return json(200, { status: "ok" });
      if (url.pathname === "/client-config") return json(200, { appVersion: "v2.55.0" });
      return json(200, { data: { companies: [] } });
    });
    await expect(ok.gateway.health()).resolves.toEqual({
      reachable: true,
      authenticated: true,
      version: "v2.55.0",
    });

    const refused = gatewayWith((url) => {
      if (url.pathname === "/healthz") return json(200, {});
      if (url.pathname === "/client-config") return json(200, {});
      return json(401, { messages: ["Token invalid."] });
    });
    await expect(refused.gateway.health()).resolves.toEqual({
      reachable: true,
      authenticated: false,
      version: null,
    });

    const throttled = gatewayWith((url) =>
      url.pathname === "/healthz" || url.pathname === "/client-config"
        ? json(200, {})
        : json(429, {}),
    );
    await expect(throttled.gateway.health()).resolves.toMatchObject({ authenticated: true });

    const down = new TwentyCrmGateway(
      new TwentyClient({
        baseUrl: "https://crm.example",
        apiKey: "x",
        fetch: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    );
    await expect(down.health()).resolves.toEqual({
      reachable: false,
      authenticated: false,
      version: null,
    });
  });
});

describe("translateTwentyError", () => {
  const api = (status: number, ...messages: string[]) =>
    new TwentyApiError(status, messages, undefined, 1, undefined);

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [500, "unreachable"],
    [503, "unreachable"],
  ])("HTTP %i devient indisponible (%s)", (status, reason) => {
    const error = translateTwentyError(api(status));
    expect(error).toBeInstanceOf(IntegrationUnavailableError);
    expect(error).toMatchObject({ reason });
    expect((error as Error).message).toMatch(/CRM/);
  });

  it("une erreur réseau devient indisponible", () => {
    expect(translateTwentyError(new TwentyNetworkError(1, new Error("x")))).toMatchObject({
      reason: "unreachable",
    });
  });

  it.each([
    ['"x" is not a domain name, for domain-typed links field', "domains"],
    ["Invalid string value 'x' for email field \"emails.primaryEmail\"", "emails"],
    ["Provided phone number is invalid abc", "phones"],
  ])("%s devient une erreur de saisie en français", (message, field) => {
    const error = translateTwentyError(api(400, message));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toHaveProperty(field);
    expect((error as Error).message).not.toContain(message);
  });

  it("transmet tel quel ce qui n'est pas une erreur de Twenty", () => {
    const other = new Error("autre");
    expect(translateTwentyError(other)).toBe(other);
  });

  it("garde le délai demandé par Twenty sur 429", () => {
    const error = translateTwentyError(new TwentyApiError(429, [], undefined, 1, 30_000));
    expect(error).toMatchObject({ retryAfterMs: 30_000 });
  });
});

describe("getCrmGateway sans configuration", () => {
  it("n'est pas configurée et chaque appel échoue en demandant la connexion", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost:5432/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("TWENTY_API_URL", "");
    vi.stubEnv("TWENTY_API_KEY", "");

    const gateway = getCrmGateway();
    expect(gateway.isConfigured).toBe(false);
    await expect(gateway.health()).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(gateway.listCompanies()).rejects.toMatchObject({ reason: "not_configured" });
    await expect(gateway.createTask({ title: "x", targets: [] })).rejects.toThrow(
      /Connexion au CRM requise/,
    );
    // Une passerelle renvoyée par une fonction async ne doit pas passer pour une promesse.
    await expect(Promise.resolve(gateway)).resolves.toBe(gateway);

    vi.unstubAllEnvs();
  });
});
