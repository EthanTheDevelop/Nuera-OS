import { eq, getTableName, is, type Table } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextNumber } from "@/modules/platform/sequences";
import { buildAuth, type Auth } from "@/server/auth/auth";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { resolvePortalContext } from "@/server/auth/portal-context";
import {
  runSeed,
  SEED_TWENTY_ID_PREFIX,
  seedId,
  seedRefusalReason,
  type SeedAccount,
} from "../../scripts/lib/seed-data";
import { createTestDatabase } from "../helpers/db";

let db: Database;
let auth: Auth;
let close: () => Promise<void>;
const now = new Date("2026-11-04T10:00:00Z");

let seededAccounts: SeedAccount[] = [];

const allTables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
);

async function countRows(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    allTables.map(async (table: Table) => [getTableName(table), await db.$count(table)] as const),
  );
  return Object.fromEntries(entries);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: "http://localhost:3000" });
});
afterAll(async () => close());

describe("garde-fous", () => {
  const local = "postgres://nuera:x@127.0.0.1:5432/nuera_os";

  it("refuse la production, même avec --allow-remote", () => {
    expect(seedRefusalReason({ NODE_ENV: "production", DATABASE_URL: local })).toMatch(
      /production/,
    );
    expect(
      seedRefusalReason({ NODE_ENV: "production", DATABASE_URL: local }, { allowRemote: true }),
    ).toMatch(/production/);
  });

  it("refuse une base distante sans demande explicite", () => {
    const remote = "postgres://u:p@db.example.com:5432/nuera";
    expect(seedRefusalReason({ NODE_ENV: "development", DATABASE_URL: remote })).toMatch(
      /db\.example\.com/,
    );
    expect(
      seedRefusalReason({ NODE_ENV: "development", DATABASE_URL: remote }, { allowRemote: true }),
    ).toBeNull();
    expect(seedRefusalReason({ NODE_ENV: "development", DATABASE_URL: local })).toBeNull();
  });

  it("dérive des identifiants stables au format UUID", () => {
    expect(seedId("company:lune")).toBe(seedId("company:lune"));
    expect(seedId("company:lune")).not.toBe(seedId("company:kine"));
    expect(seedId("company:lune")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("seed", () => {
  it("remplit toutes les tables, tous les comptes demandés, et affiche les mots de passe", async () => {
    const { accounts } = await runSeed({ db, auth }, { now });
    seededAccounts = accounts;

    const counts = await countRows();
    const empty = Object.entries(counts)
      .filter(([, count]) => count === 0)
      .map(([name]) => name);
    // Tables de session : vides tant que personne ne s'est connecté.
    expect(empty.sort()).toEqual(["sessions", "two_factors", "verifications"]);

    expect(accounts.every((account) => account.created && account.password)).toBe(true);
    const roles = accounts.map((account) => account.role);
    for (const role of ["admin", "member", "contractor", "viewer", "client"] as const) {
      expect(roles).toContain(role);
    }
  }, 120_000);

  it("donne à chaque étape, statut et catégorie de quoi tester les écrans", async () => {
    const stages = await db
      .select({ stage: schema.opportunities.stage })
      .from(schema.opportunities);
    expect(new Set(stages.map((row) => row.stage))).toEqual(new Set(schema.OPPORTUNITY_STAGES));
    const statuses = await db.select({ status: schema.tickets.status }).from(schema.tickets);
    expect(new Set(statuses.map((row) => row.status))).toEqual(
      new Set(["received", "qualified", "in_progress", "resolved", "closed"]),
    );
  });

  it("n'écrit que des identifiants Twenty factices", async () => {
    for (const table of [schema.companies, schema.contacts, schema.opportunities]) {
      const rows = await db.select({ twentyId: table.twentyId }).from(table);
      for (const row of rows) expect(row.twentyId.startsWith(SEED_TWENTY_ID_PREFIX)).toBe(true);
    }
  });

  it("ne simule aucune intégration connectée et ne laisse aucun e-mail à envoyer", async () => {
    const connections = await db.select().from(schema.integrationConnections);
    expect(connections).toHaveLength(schema.INTEGRATION_SERVICES.length);
    expect(connections.some((row) => row.status === "connected")).toBe(false);

    const outbox = await db.select().from(schema.emailOutbox);
    expect(outbox.some((row) => row.status === "pending")).toBe(false);
  });

  it("n'expose aucun événement au moteur d'automatisation", async () => {
    const events = await db.select().from(schema.domainEvents);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.dispatchedAt !== null)).toBe(true);
  });

  it("donne deux clients du portail sur deux entreprises différentes", async () => {
    const memberships = await db.select().from(schema.portalMemberships);
    expect(memberships).toHaveLength(2);
    expect(new Set(memberships.map((row) => row.companyId)).size).toBe(2);

    for (const membership of memberships) {
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, membership.userId));
      expect(user?.role).toBe("client");
      const ctx = await resolvePortalContext(db, {
        userId: membership.userId,
        role: "client",
        name: user?.name ?? "",
        email: user?.email ?? "",
      });
      expect(ctx.companyId).toBe(membership.companyId);
    }
  });

  it("ouvre une session avec le mot de passe affiché, et aucune avec un autre", async () => {
    const admin = seededAccounts.find((account) => account.role === "admin");
    if (!admin?.password) throw new Error("Compte administrateur attendu");
    const result = await auth.api.signInEmail({
      body: { email: admin.email, password: admin.password },
    });
    expect(result.user.email).toBe(admin.email);
    await expect(
      auth.api.signInEmail({ body: { email: admin.email, password: "faux-mot-de-passe" } }),
    ).rejects.toThrow();
  });

  it("place le compteur après les numéros existants", async () => {
    expect(await nextNumber(db, "quote", now)).toBe("D-2026-018");
    expect(await nextNumber(db, "project", now)).toBe("P-2026-009");
  });

  it("est idempotent : un second passage n'ajoute rien et garde les mots de passe", async () => {
    const before = await countRows();
    const { accounts } = await runSeed({ db, auth }, { now: new Date("2026-12-01T10:00:00Z") });
    expect(accounts.every((account) => !account.created && account.password === null)).toBe(true);

    const after = await countRows();
    delete before.audit_log;
    delete after.audit_log;
    expect(after).toEqual(before);
    // Le compteur consommé juste avant n'est pas redescendu.
    expect(await nextNumber(db, "quote", now)).toBe("D-2026-019");
  }, 120_000);
});
