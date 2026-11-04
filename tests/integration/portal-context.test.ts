import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePortalContext } from "@/server/auth/portal-context";
import { auditLog, portalMemberships, type PortalMembership } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError } from "@/server/errors";
import { createTestActor, createTestDatabase } from "../helpers/db";
import { createPortalClient, createPortalTestContext } from "../helpers/factories";

let db: Database;
let close: () => Promise<void>;

/** Session simulée pour `getCurrentActor` : la base et la logique restent les vraies. */
const session = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; name: string; email: string },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/server/auth/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () => (session.user ? { user: session.user } : null),
    },
  }),
}));
vi.mock("@/server/db/client", () => ({ getDb: () => db }));

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(() => {
  session.user = null;
});

async function setStatus(membership: PortalMembership, status: PortalMembership["status"]) {
  await db.update(portalMemberships).set({ status }).where(eq(portalMemberships.id, membership.id));
}

describe("resolvePortalContext", () => {
  it("construit le contexte depuis l'adhésion", async () => {
    const { actor, company, contact } = await createPortalClient(db);
    await expect(resolvePortalContext(db, actor)).resolves.toEqual({
      db,
      actor,
      companyId: company.id,
      contactId: contact.id,
    });
  });

  it("refuse une adhésion révoquée", async () => {
    const { actor, membership } = await createPortalClient(db);
    await setStatus(membership, "revoked");
    await expect(resolvePortalContext(db, actor)).rejects.toThrow(ForbiddenError);
  });

  it("refuse un client sans adhésion", async () => {
    const actor = await createTestActor(db, "client");
    await expect(resolvePortalContext(db, actor)).rejects.toThrow(ForbiddenError);
  });

  it.each(["admin", "member", "contractor", "viewer"] as const)(
    "refuse le rôle %s, même avec une adhésion",
    async (role) => {
      const { actor } = await createPortalClient(db);
      await expect(resolvePortalContext(db, { ...actor, role })).rejects.toThrow(ForbiddenError);
    },
  );

  it("active une invitation au premier accès, avec une trace d'audit", async () => {
    const { actor, membership } = await createPortalClient(db, { status: "invited" });
    await resolvePortalContext(db, actor);

    const [row] = await db
      .select()
      .from(portalMemberships)
      .where(eq(portalMemberships.id, membership.id));
    expect(row?.status).toBe("active");
    expect(row?.lastSeenAt).toBeInstanceOf(Date);

    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, membership.id));
    expect(entries.map((entry) => entry.action)).toEqual(["portal.membership_activated"]);

    // Une seconde visite ne journalise pas une seconde activation.
    await resolvePortalContext(db, actor);
    expect(
      await db.select().from(auditLog).where(eq(auditLog.entityId, membership.id)),
    ).toHaveLength(1);
  });

  it("met à jour la dernière visite, sans écrire à chaque requête", async () => {
    const { actor, membership } = await createPortalClient(db);
    const read = async () =>
      (
        await db
          .select({ lastSeenAt: portalMemberships.lastSeenAt })
          .from(portalMemberships)
          .where(eq(portalMemberships.id, membership.id))
      )[0]?.lastSeenAt;

    await resolvePortalContext(db, actor);
    const first = await read();
    expect(first).toBeInstanceOf(Date);
    await resolvePortalContext(db, actor);
    expect((await read())?.getTime()).toBe(first?.getTime());

    const old = new Date(Date.now() - 60 * 60 * 1000);
    await db
      .update(portalMemberships)
      .set({ lastSeenAt: old })
      .where(eq(portalMemberships.id, membership.id));
    await resolvePortalContext(db, actor);
    expect((await read())?.getTime()).toBeGreaterThan(old.getTime());
  });

  it("voit une révocation dès la requête suivante", async () => {
    const { actor, membership } = await createPortalClient(db);
    await resolvePortalContext(db, actor);
    await setStatus(membership, "revoked");
    await expect(resolvePortalContext(db, actor)).rejects.toThrow(ForbiddenError);
  });
});

describe("createPortalTestContext", () => {
  it("donne un contexte conforme à celui du serveur", async () => {
    const ctx = await createPortalTestContext(db);
    const resolved = await resolvePortalContext(db, ctx.actor);
    expect(resolved.companyId).toBe(ctx.companyId);
    expect(resolved.contactId).toBe(ctx.contactId);
  });
});

describe("session", () => {
  const signInAs = (actor: { userId: string; role: string; name: string; email: string }) => {
    session.user = { id: actor.userId, role: actor.role, name: actor.name, email: actor.email };
  };

  // `cache` de React n'agit qu'en rendu serveur : chaque appel relit bien la session simulée ici.
  async function loadSession() {
    return import("@/server/auth/session");
  }

  it("getPortalContext : sans session, vers la connexion", async () => {
    const { getPortalContext } = await loadSession();
    await expect(getPortalContext()).rejects.toThrow("REDIRECT:/login");
  });

  it("getPortalContext : renvoie le contexte du client", async () => {
    const { actor, company, contact } = await createPortalClient(db);
    signInAs(actor);
    const { getPortalContext } = await loadSession();
    await expect(getPortalContext()).resolves.toMatchObject({
      companyId: company.id,
      contactId: contact.id,
    });
  });

  it("getPortalContext : refuse une adhésion révoquée ou absente", async () => {
    const { actor, membership } = await createPortalClient(db);
    await setStatus(membership, "revoked");
    signInAs(actor);
    const { getPortalContext } = await loadSession();
    await expect(getPortalContext()).rejects.toThrow(ForbiddenError);

    signInAs(await createTestActor(db, "client"));
    await expect(getPortalContext()).rejects.toThrow(ForbiddenError);
  });

  it("getPortalContext : un membre de l'équipe repart vers l'agence", async () => {
    signInAs(await createTestActor(db, "member"));
    const { getPortalContext } = await loadSession();
    await expect(getPortalContext()).rejects.toThrow("REDIRECT:/");
  });

  it("requireInternalActor : un client repart vers son espace", async () => {
    const { actor } = await createPortalClient(db);
    signInAs(actor);
    const { requireInternalActor, getServiceContext } = await loadSession();
    await expect(requireInternalActor()).rejects.toThrow("REDIRECT:/espace");
    await expect(getServiceContext()).rejects.toThrow("REDIRECT:/espace");
  });

  it.each(["admin", "member", "contractor", "viewer"] as const)(
    "requireInternalActor : accepte %s",
    async (role) => {
      const actor = await createTestActor(db, role);
      signInAs(actor);
      const { requireInternalActor } = await loadSession();
      await expect(requireInternalActor()).resolves.toMatchObject({ userId: actor.userId, role });
    },
  );

  it("getServiceContext : expose le port CRM, non configuré sans connexion Twenty", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test@127.0.0.1/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("TWENTY_API_URL", "");
    vi.stubEnv("TWENTY_API_KEY", "");
    try {
      signInAs(await createTestActor(db, "admin"));
      const { getServiceContext } = await loadSession();
      const ctx = await getServiceContext();
      expect(ctx.crm?.isConfigured).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuse un rôle inconnu : l'autorisation échoue par défaut", async () => {
    session.user = {
      id: crypto.randomUUID(),
      role: "superadmin",
      name: "X",
      email: "x@test.local",
    };
    const { requireActor } = await loadSession();
    await expect(requireActor()).rejects.toThrow(ForbiddenError);
  });
});
