import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserAccount } from "@/modules/users/user.service";
import { buildAuth, CLOSED_AUTH_PATHS, type Auth } from "@/server/auth/auth";
import { auditLog, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";

/**
 * Surface HTTP de better-auth, testée par son vrai routeur (`auth.handler`). Une route est soit
 * employée par l'interface, soit fermée : une mise à jour qui en ajoute une fait échouer ce fichier.
 */
const BASE = "http://localhost:3000";
const PASSWORD = "phrase-de-passe-de-test";

/** Appelées par l'interface (`src/lib/auth-client.ts` et ses appelants). */
const OPEN_PATHS = [
  "/sign-in/email",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/sign-out",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/change-password",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
];
/** Sans effet : santé et page d'erreur échappée, et l'OAuth, sans fournisseur configuré. */
const HARMLESS_PATHS = ["/ok", "/error", "/callback/:id"];

let db: Database;
let auth: Auth;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: BASE });
});
afterAll(async () => close());

function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: init.method ?? "POST",
      headers: {
        origin: BASE,
        "content-type": "application/json",
        "x-forwarded-for": `198.18.0.${Math.floor(Math.random() * 250)}`,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      ...(init.method === "GET" ? {} : { body: JSON.stringify(init.body ?? {}) }),
    }),
  );
}

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

async function createAccount(email: string, role: "viewer" | "client") {
  return createUserAccount(
    { db, auth },
    { email, name: "Compte de test", role, password: PASSWORD },
    { actorId: null, via: "cli" },
  );
}

async function signIn(email: string): Promise<string> {
  const response = await call("/sign-in/email", { body: { email, password: PASSWORD } });
  expect(response.status).toBe(200);
  return cookieOf(response);
}

describe("routes de better-auth", () => {
  it("classe chaque route : employée, sans effet ou fermée", () => {
    const declared = Object.values(auth.api)
      .map((endpoint) => (endpoint as { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    const classified = new Set([...OPEN_PATHS, ...HARMLESS_PATHS, ...CLOSED_AUTH_PATHS]);
    expect(declared.filter((path) => !classified.has(path))).toEqual([]);
  });

  it("répond 404 sur chaque route fermée, avec ou sans session", async () => {
    await createAccount("ferme@test.local", "viewer");
    const cookie = await signIn("ferme@test.local");
    for (const path of CLOSED_AUTH_PATHS) {
      expect((await call(path)).status, `POST ${path}`).toBe(404);
      expect((await call(path, { cookie })).status, `POST ${path} en session`).toBe(404);
      expect((await call(path, { method: "GET", cookie })).status, `GET ${path}`).toBe(404);
    }
  });

  it("ne laisse plus une session écrire son nom ou son image hors du service", async () => {
    const { id } = await createAccount("nom@test.local", "viewer");
    const cookie = await signIn("nom@test.local");
    const response = await call("/update-user", {
      cookie,
      body: { name: "<img src=x onerror=alert(1)>", image: "javascript:alert(1)" },
    });
    expect(response.status).toBe(404);
    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row?.name).toBe("Compte de test");
    expect(row?.image).toBeNull();
  });

  it("garde la lecture de session côté serveur, et le parcours du client navigateur", async () => {
    await createAccount("parcours@test.local", "viewer");
    const seen: string[] = [];
    const client = createAuthClient({
      baseURL: BASE,
      plugins: [twoFactorClient()],
      fetchOptions: {
        customFetchImpl: (input, init) => {
          const url = new URL(String(input));
          seen.push(url.pathname.replace("/api/auth", ""));
          const headers = new Headers(init?.headers);
          headers.set("origin", BASE);
          headers.set("x-forwarded-for", "198.18.1.1");
          return auth.handler(new Request(url, { ...init, headers }));
        },
      },
    });
    const { data, error } = await client.signIn.email({
      email: "parcours@test.local",
      password: PASSWORD,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(seen.filter((path) => CLOSED_AUTH_PATHS.includes(path))).toEqual([]);

    const cookie = await signIn("parcours@test.local");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("parcours@test.local");
  });

  it("journalise la déconnexion", async () => {
    const { id } = await createAccount("sortie@test.local", "viewer");
    const cookie = await signIn("sortie@test.local");
    expect((await call("/sign-out", { cookie })).status).toBe(200);
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(rows.map((row) => row.action)).toContain("auth.signed_out");
  });
});

describe("mot de passe d'un client", () => {
  it("n'existe pas pour un compte invité : aucune route ne peut en créer un", async () => {
    await createAccount("equipe@test.local", "viewer");
    const response = await call("/set-password", { body: { newPassword: PASSWORD } });
    expect(response.status).toBe(404);
  });

  it("répond comme un mauvais mot de passe en production, même s'il est juste", async () => {
    await createAccount("client@test.local", "client");
    const refused = await call("/sign-in/email", {
      body: { email: "CLIENT@test.local", password: PASSWORD },
    });
    const wrong = await call("/sign-in/email", {
      body: { email: "inconnu@test.local", password: PASSWORD },
    });
    expect(refused.status).toBe(401);
    expect(refused.headers.getSetCookie()).toEqual([]);
    expect(await refused.json()).toEqual(await wrong.json());
  });

  it("reste ouvert à l'équipe, et au client du seed hors production", async () => {
    await createAccount("membre@test.local", "viewer");
    await signIn("membre@test.local");

    const development = buildAuth({
      db,
      secret: "s".repeat(32),
      baseURL: BASE,
      allowClientPassword: true,
    });
    await createAccount("seed-client@test.local", "client");
    const result = await development.api.signInEmail({
      body: { email: "seed-client@test.local", password: PASSWORD },
    });
    expect(result.user.email).toBe("seed-client@test.local");
  });
});
