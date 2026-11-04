import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DocusealClient } from "@/integrations/docuseal/docuseal.client";
import type { QuoteDeps } from "@/modules/quotes/quote.deps";
import type { Role } from "@/server/auth/roles";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { FakeCrmGateway } from "../../helpers/fake-crm-gateway";
import { createTestActor } from "../../helpers/db";
import { createCompany } from "../../helpers/factories";

export interface StubRequest {
  method: string;
  path: string;
  token: string | undefined;
  body: unknown;
}

/** Serveur HTTP local qui répond comme l'API DocuSeal documentée. Jamais le vrai service. */
export class DocusealStub {
  readonly requests: StubRequest[] = [];
  /** Statut forcé sur la prochaine requête : panne, clé refusée… */
  failWith: number | null = null;
  /** Réponse de `GET /submissions/{id}`. */
  submissionStatus: "pending" | "completed" | "declined" | "expired" = "pending";
  /** Réponse de `GET /submissions/{id}/documents` : des adresses à durée de vie limitée. */
  signedDocuments: { name: string; url: string }[] = [
    { name: "Devis signé", url: "https://docuseal.test/file/signe.pdf?expires=1" },
  ];
  private nextId = 1000;
  private server: Server | undefined;

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request).then(({ status, body }) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  get url(): string {
    const { port } = this.server?.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  get createCalls(): StubRequest[] {
    return this.requests.filter((request) => request.method === "POST");
  }

  private async handle(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const path = request.url ?? "";
    const method = request.method ?? "";
    this.requests.push({
      method,
      path,
      token: request.headers["x-auth-token"] as string | undefined,
      body: raw ? JSON.parse(raw) : null,
    });
    if (this.failWith) {
      const status = this.failWith;
      this.failWith = null;
      return { status, body: { error: "panne simulée" } };
    }
    if (method === "POST" && path === "/submissions/html") {
      this.nextId += 1;
      return {
        status: 200,
        body: {
          id: this.nextId,
          name: "Devis",
          status: "pending",
          source: "api",
          submitters: [{ id: 1, email: "x@test.local", status: "sent", role: "Client" }],
        },
      };
    }
    const documents = /^\/submissions\/(\d+)\/documents(\?merge=true)?$/.exec(path);
    if (documents && method === "GET") {
      return {
        status: 200,
        body: { id: Number(documents[1]), documents: this.signedDocuments },
      };
    }
    const match = /^\/submissions\/(\d+)$/.exec(path);
    if (match && method === "GET") {
      return {
        status: 200,
        body: {
          id: Number(match[1]),
          status: this.submissionStatus,
          completed_at: this.submissionStatus === "completed" ? "2026-11-02T10:00:00Z" : null,
          submitters: [],
        },
      };
    }
    if (match && method === "DELETE") return { status: 200, body: { id: Number(match[1]) } };
    return { status: 404, body: { error: "not found" } };
  }

  deps(apiKey = "cle-de-test"): QuoteDeps {
    return { docuseal: new DocusealClient({ baseUrl: this.url, apiKey }) };
  }
}

/** Passerelle absente : comme l'application sans variables d'environnement. */
export const UNCONFIGURED_DEPS: QuoteDeps = {
  docuseal: {
    isConfigured: false,
    createSubmission: () => Promise.reject(new Error("ne doit pas être appelé")),
    getSubmission: () => Promise.reject(new Error("ne doit pas être appelé")),
    getSubmissionDocuments: () => Promise.reject(new Error("ne doit pas être appelé")),
    archiveSubmission: () => Promise.reject(new Error("ne doit pas être appelé")),
  },
};

export interface Fixture {
  db: Database;
  crm: FakeCrmGateway;
  admin: ServiceContext;
  member: ServiceContext;
  viewer: ServiceContext;
  contractor: ServiceContext;
  client: ServiceContext;
}

export async function createFixture(db: Database): Promise<Fixture> {
  const crm = new FakeCrmGateway();
  const as = async (role: Role): Promise<ServiceContext> => ({
    db,
    actor: await createTestActor(db, role),
    crm,
  });
  return {
    db,
    crm,
    admin: await as("admin"),
    member: await as("member"),
    viewer: await as("viewer"),
    contractor: await as("contractor"),
    client: await as("client"),
  };
}

/** Client et affaire présents dans la fausse passerelle : les écritures CRM aboutissent. */
export async function createCrmOpportunity(
  fixture: Fixture,
  options: { amountCents?: number | null; companyId?: string } = {},
) {
  const companyId = options.companyId ?? (await createCompany(fixture.db)).id;
  const record = await fixture.crm.createOpportunity({
    name: "Affaire de test",
    stage: "QUALIFIED",
  });
  const [opportunity] = await fixture.db
    .insert(schema.opportunities)
    .values({
      twentyId: record.id,
      companyId,
      name: "Affaire de test",
      stage: "QUALIFIED",
      amountCents: options.amountCents ?? 500_000,
    })
    .returning();
  if (!opportunity) throw new Error("Affaire de test non créée");
  return { opportunity, companyId };
}

export const LINE = {
  label: "Site vitrine · 5 pages",
  unitLabel: "12 j",
  quantity: 1,
  unitPriceCents: 780_000,
  estimatedCostCents: 288_000,
  estimatedMinutes: 5040,
};

export const IN_30_DAYS = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

export function content(overrides: Record<string, unknown> = {}) {
  return {
    title: "Site vitrine",
    scope: "5 pages",
    exclusions: "photos",
    conditions: "2 retours",
    validUntil: IN_30_DAYS,
    depositPercent: 30,
    taxPercent: 20,
    lines: [LINE],
    ...overrides,
  };
}
