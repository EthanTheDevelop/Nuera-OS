import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Agence qui exige la double authentification, compte de l'équipe sans elle : les routes partent
 * vers l'enrôlement. Une redirection de Next.js est une exception : la rattraper donnerait un 500.
 */
const state = vi.hoisted(() => ({
  actor: { userId: "u", role: "admin", name: "A", email: "a@test.local" } as unknown,
}));

vi.mock("@/server/auth/session", () => {
  const enrol = async () => redirect("/profil?double-authentification=requise#securite");
  return {
    getCurrentActor: async () => state.actor,
    getServiceContext: enrol,
    requireInternalActor: enrol,
  };
});
vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ BETTER_AUTH_URL: "http://localhost", STORAGE_MAX_UPLOAD_MB: 1 }),
}));

const { GET: financeExport } = await import("@/app/api/finance/export/route");
const { GET: reportingExport } = await import("@/app/api/reporting/export/route");
const { GET: dataExport } = await import("@/app/api/export/route");
const { GET: download } = await import("@/app/api/documents/[id]/download/route");
const { POST: upload } = await import("@/app/api/documents/upload/route");
const { POST: addVersion } = await import("@/app/api/documents/[id]/versions/route");

const ID = "00000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ id: ID }) };
const get = (path: string) => new NextRequest(`http://localhost${path}`);
const post = (path: string) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: "http://localhost" },
  });

const ROUTES: [string, () => Promise<Response>][] = [
  ["/api/finance/export", () => financeExport(get("/api/finance/export?jeu=factures"))],
  ["/api/reporting/export", () => reportingExport(get("/api/reporting/export"))],
  ["/api/export", () => dataExport(get("/api/export"))],
  ["/api/documents/[id]/download", () => download(get(`/api/documents/${ID}/download`), params)],
  ["/api/documents/upload", () => upload(post("/api/documents/upload?title=x"))],
  ["/api/documents/[id]/versions", () => addVersion(post(`/api/documents/${ID}/versions`), params)],
];

describe("compte de l'équipe à enrôler en double authentification", () => {
  beforeEach(() => {
    state.actor = { userId: "u", role: "admin", name: "A", email: "a@test.local" };
  });

  it.each(ROUTES)("%s redirige vers l'enrôlement, sans 500", async (_name, call) => {
    const outcome = await call().catch((error: unknown) => error);
    expect(outcome).not.toBeInstanceOf(Response);
    expect(isRedirectError(outcome)).toBe(true);
  });
});
