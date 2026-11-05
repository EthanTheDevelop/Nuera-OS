import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { createTestContext, createTestDatabase } from "../../helpers/db";

/** La route d'export elle-même : session, codes de réponse, en-têtes. */
const state = vi.hoisted(() => ({
  actor: null as unknown,
  context: null as unknown,
  /** Compte tenu de s'enrôler en double authentification : `getServiceContext` le redirige. */
  mustEnrol: false,
}));

vi.mock("@/server/auth/session", async () => {
  const { redirect } = await import("next/navigation");
  return {
    getCurrentActor: async () => state.actor,
    getServiceContext: async () => {
      if (state.mustEnrol) redirect("/profil?double-authentification=requise#securite");
      return state.context;
    },
  };
});

const { GET } = await import("@/app/api/reporting/export/route");

const exportCsv = () => GET(new Request("http://localhost/api/reporting/export?periode=abc"));

describe("route d'export du reporting", () => {
  let close: () => Promise<void>;
  let admin: ServiceContext;
  let viewer: ServiceContext;
  const as = (ctx: { actor: Actor } | null) => {
    state.actor = ctx?.actor ?? null;
    state.context = ctx;
    state.mustEnrol = false;
  };

  beforeAll(async () => {
    const database = await createTestDatabase();
    close = database.close;
    admin = await createTestContext(database.db, "admin");
    viewer = await createTestContext(database.db, "viewer");
  });
  afterAll(() => close());

  it("sans session : 401, jamais mis en cache", async () => {
    as(null);
    const response = await exportCsv();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sans les droits : 403, un client aussi", async () => {
    as(viewer);
    expect((await exportCsv()).status).toBe(403);
    as({ actor: { ...viewer.actor, role: "client" } });
    expect((await exportCsv()).status).toBe(403);
  });

  it("avec les droits : un CSV en pièce jointe, une valeur d'URL inconnue ne casse rien", async () => {
    as(admin);
    const response = await exportCsv();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="nuera-reporting-mois-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(await response.text()).toContain("Chiffre d'affaires");
  });

  it("un compte à enrôler part vers son profil, ce n'est pas une panne", async () => {
    as(admin);
    state.mustEnrol = true;
    await expect(exportCsv()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});
