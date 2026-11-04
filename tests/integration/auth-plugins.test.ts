import { getTableColumns } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getAuthTables } from "better-auth/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUserAccount } from "@/modules/users/user.service";
import { buildAuth, type Auth } from "@/server/auth/auth";
import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "@/server/auth/magic-link";
import {
  accounts,
  emailOutbox,
  portalMemberships,
  sessions,
  twoFactors,
  users,
  verifications,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../helpers/db";
import { createCompany, createContact } from "../helpers/factories";

let db: Database;
let auth: Auth;
let close: () => Promise<void>;

const PASSWORD = "phrase-de-passe-de-test";
const headers = () => new Headers({ origin: "http://localhost:3000" });

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: "http://localhost:3000" });
});
afterAll(async () => close());

async function createAccount(email: string, role: "admin" | "member" | "client") {
  return createUserAccount(
    { db, auth },
    { email, name: "Compte de test", role, password: PASSWORD },
    { actorId: null, via: "cli" },
  );
}

/** Compte client avec adhésion au portail. */
async function createClient(email: string, status: "invited" | "active" | "revoked" = "active") {
  const { id } = await createAccount(email, "client");
  const company = await createCompany(db);
  const contact = await createContact(db, { companyId: company.id });
  await db
    .insert(portalMemberships)
    .values({ userId: id, companyId: company.id, contactId: contact.id, status });
  return id;
}

const outboxFor = (email: string) =>
  db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, email));

/** Jeton contenu dans le lien déposé dans la boîte d'envoi. */
function tokenFrom(text: string | null): string {
  const url = text?.split("\n").find((line) => line.startsWith("http"));
  const token = url ? new URL(url).searchParams.get("token") : null;
  if (!token) throw new Error("Lien de connexion introuvable");
  return token;
}

describe("schéma better-auth", () => {
  it("couvre chaque table et chaque champ attendus par better-auth", () => {
    const tables = {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      twoFactor: twoFactors,
    } as const;
    const expected = getAuthTables(auth.options);
    expect(
      Object.keys(expected)
        .filter((model) => model !== "rateLimit")
        .sort(),
    ).toEqual(Object.keys(tables).sort());
    for (const [model, table] of Object.entries(tables)) {
      const columns = Object.keys(getTableColumns(table));
      for (const field of Object.keys(expected[model]?.fields ?? {})) {
        expect(columns, `${model}.${field}`).toContain(field);
      }
    }
  });
});

describe("lien de connexion", () => {
  it("écrit le lien dans la boîte d'envoi pour un client au portail, valable 24 h", async () => {
    const email = "claire@test.local";
    await createClient(email);
    const before = Date.now();
    await auth.api.signInMagicLink({ body: { email }, headers: headers() });

    const [mail] = await outboxFor(email);
    expect(mail).toMatchObject({ status: "pending", template: "portal_magic_link" });
    expect(mail?.html).toContain("Accéder à mon espace");

    // Jeton haché en base : le lien de l'e-mail ne se retrouve pas dans `verifications`.
    const token = tokenFrom(mail?.text ?? null);
    const rows = await db.select().from(verifications);
    expect(rows.some((row) => row.identifier.includes(token))).toBe(false);
    const stored = rows.find((row) => row.identifier.startsWith("magic-link:"));
    const remaining = (stored?.expiresAt.getTime() ?? 0) - before;
    expect(Math.round(remaining / 1000 / 3600)).toBe(MAGIC_LINK_EXPIRES_IN_SECONDS / 3600);
  });

  it("connecte le client avec le lien, une seule fois", async () => {
    const email = "marc@test.local";
    await createClient(email, "invited");
    await auth.api.signInMagicLink({ body: { email }, headers: headers() });
    const [mail] = await outboxFor(email);
    const token = tokenFrom(mail?.text ?? null);

    const result = await auth.api.magicLinkVerify({ query: { token }, headers: headers() });
    expect(result).toMatchObject({ user: { email } });

    await expect(
      auth.api.magicLinkVerify({ query: { token }, headers: headers() }),
    ).rejects.toThrow();
  });

  it("ne crée jamais de compte depuis un lien, même avec un jeton valide", async () => {
    const email = "inconnu@test.local";
    const sent: { email: string; url: string }[] = [];
    // Envoi direct, sans le filtre : on éprouve `disableSignUp` lui-même.
    const unfiltered = buildAuth({
      db,
      secret: "s".repeat(32),
      baseURL: "http://localhost:3000",
      sendMagicLink: async (mail) => void sent.push(mail),
    });
    await unfiltered.api.signInMagicLink({ body: { email }, headers: headers() });
    expect(sent).toHaveLength(0);

    // Jeton fabriqué comme le ferait le plugin : la vérification doit refuser la création.
    const { createHash } = await import("node:crypto");
    const token = "jeton-pour-une-adresse-inconnue";
    const hashed = createHash("sha256").update(token).digest("base64url");
    await db.insert(verifications).values({
      identifier: `magic-link:${hashed}`,
      value: JSON.stringify({ type: "magic-link", email }),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      auth.api.magicLinkVerify({ query: { token }, headers: headers() }),
    ).rejects.toThrow();
    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  });

  it.each(["admin", "member"] as const)(
    "n'envoie rien à un compte %s : pas de contournement du mot de passe et du second facteur",
    async (role) => {
      const email = `staff-${role}@test.local`;
      await createAccount(email, role);
      await expect(
        auth.api.signInMagicLink({ body: { email }, headers: headers() }),
      ).resolves.toMatchObject({ status: true });
      expect(await outboxFor(email)).toHaveLength(0);
    },
  );

  it("n'envoie rien à une adresse inconnue, avec la même réponse", async () => {
    const email = "personne@test.local";
    await expect(
      auth.api.signInMagicLink({ body: { email }, headers: headers() }),
    ).resolves.toMatchObject({ status: true });
    expect(await outboxFor(email)).toHaveLength(0);
  });

  it("n'envoie rien à un client révoqué ou sans adhésion", async () => {
    await createClient("revoque@test.local", "revoked");
    await createAccount("sans-adhesion@test.local", "client");
    for (const email of ["revoque@test.local", "sans-adhesion@test.local"]) {
      await auth.api.signInMagicLink({ body: { email }, headers: headers() });
      expect(await outboxFor(email)).toHaveLength(0);
    }
  });

  it("passe par la fonction d'envoi injectée, sans toucher à la boîte d'envoi", async () => {
    const email = "injecte@test.local";
    await createClient(email);
    const send = vi.fn(async () => undefined);
    const custom = buildAuth({
      db,
      secret: "s".repeat(32),
      baseURL: "http://localhost:3000",
      sendMagicLink: send,
    });
    await custom.api.signInMagicLink({ body: { email: email.toUpperCase() }, headers: headers() });
    expect(send).toHaveBeenCalledOnce();
    expect(await outboxFor(email)).toHaveLength(0);
  });
});

describe("inscription publique", () => {
  it("reste désactivée", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "self@test.local", password: PASSWORD, name: "S" } }),
    ).rejects.toThrow();
  });
});

describe("double authentification", () => {
  async function signIn(email: string): Promise<Headers> {
    const { headers: responseHeaders } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = (responseHeaders.get("set-cookie") ?? "")
      .split(/,(?=\s*[\w.-]+=)/)
      .map((part) => part.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");
    return new Headers({ cookie });
  }

  it("enregistre un secret chiffré, puis exige le second facteur à la connexion", async () => {
    const email = "associe@test.local";
    const { id } = await createAccount(email, "admin");
    const cookies = await signIn(email);

    const enrolled = await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers: cookies,
    });
    if (enrolled.method !== "totp") throw new Error("TOTP attendu");
    expect(enrolled.totpURI).toContain("Nuera%20OS");
    expect(enrolled.backupCodes.length).toBeGreaterThan(0);

    const [row] = await db.select().from(twoFactors).where(eq(twoFactors.userId, id));
    const secret = new URL(enrolled.totpURI).searchParams.get("secret");
    expect(row?.secret).toBeTruthy();
    expect(row?.secret).not.toBe(secret);

    // Sans vérification TOTP, l'activation n'est pas encore acquise.
    const [pending] = await db.select().from(users).where(eq(users.id, id));
    expect(pending?.twoFactorEnabled).toBe(false);

    await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, id));
    const result = await auth.api.signInEmail({ body: { email, password: PASSWORD } });
    expect(result).toMatchObject({ twoFactorRedirect: true });
  });
});
