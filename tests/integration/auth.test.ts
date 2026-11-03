import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserAccount } from "@/modules/users/user.service";
import { buildAuth, type Auth } from "@/server/auth/auth";
import { accounts, auditLog, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ValidationError } from "@/server/errors";
import { createTestDatabase } from "../helpers/db";

/**
 * Vérifie la configuration de sécurité de better-auth sur une vraie base PostgreSQL
 * (PGlite) : ce sont des garanties, pas des détails d'implémentation.
 */
let db: Database;
let auth: Auth;
let close: () => Promise<void>;

const PASSWORD = "phrase-de-passe-de-test";

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: "http://localhost:3000" });
});
afterAll(async () => close());

async function createAccount(email: string, role: "admin" | "member") {
  return createUserAccount(
    { db, auth },
    { email, name: "Compte de test", role, password: PASSWORD },
    { actorId: null, via: "cli" },
  );
}

/** Ouvre une session et renvoie l'en-tête Cookie correspondant. */
async function signIn(email: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = (headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[\w.-]+=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
  return new Headers({ cookie });
}

describe("authentification", () => {
  it("refuse l'inscription publique", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: "self@test.local", password: PASSWORD, name: "Self" },
      }),
    ).rejects.toThrow();
  });

  it("crée un compte, le journalise et normalise l'adresse", async () => {
    const created = await createAccount("Alice@Test.local", "member");
    expect(created.email).toBe("alice@test.local");

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "user.created"));
    expect(entry?.entityId).toBe(created.id);
    expect(JSON.stringify(entry?.metadata)).not.toContain(PASSWORD);
  });

  it("refuse un doublon, un rôle inconnu et un mot de passe trop court", async () => {
    await expect(createAccount("alice@test.local", "member")).rejects.toThrow(ConflictError);
    await expect(
      createUserAccount(
        { db, auth },
        { email: "bob@test.local", name: "Bob", role: "superadmin", password: PASSWORD },
        { actorId: null, via: "cli" },
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      createUserAccount(
        { db, auth },
        { email: "bob@test.local", name: "Bob", role: "member", password: "court" },
        { actorId: null, via: "cli" },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("ne stocke jamais le mot de passe en clair", async () => {
    const rows = await db.select({ password: accounts.password }).from(accounts);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.password).not.toContain(PASSWORD);
  });

  it("ouvre une session avec le bon mot de passe et la journalise", async () => {
    const result = await auth.api.signInEmail({
      body: { email: "alice@test.local", password: PASSWORD },
    });
    expect(result.user.email).toBe("alice@test.local");
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, "auth.signed_in"));
    expect(entries.length).toBeGreaterThan(0);
  });

  it("refuse un mauvais mot de passe", async () => {
    await expect(
      auth.api.signInEmail({
        body: { email: "alice@test.local", password: "mauvais-mot-de-passe" },
      }),
    ).rejects.toThrow();
  });

  it("refuse la connexion d'un compte désactivé", async () => {
    await createAccount("carol@test.local", "member");
    await db.update(users).set({ banned: true }).where(eq(users.email, "carol@test.local"));
    await expect(
      auth.api.signInEmail({ body: { email: "carol@test.local", password: PASSWORD } }),
    ).rejects.toThrow();
  });

  it("n'autorise l'usurpation d'identité à aucun rôle, même administrateur", async () => {
    await createAccount("admin@test.local", "admin");
    const target = await createAccount("dave@test.local", "member");
    const headers = await signIn("admin@test.local");

    await expect(
      auth.api.impersonateUser({ body: { userId: target.id }, headers }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("n'autorise pas un collaborateur à créer des comptes", async () => {
    const headers = await signIn("alice@test.local");
    await expect(
      auth.api.createUser({
        body: { email: "eve@test.local", name: "Eve", password: PASSWORD },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
