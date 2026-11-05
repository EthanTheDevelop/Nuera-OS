import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Double authentification exigée et absente : le mot de passe seul ouvre `/profil`, pour s'enrôler,
 * mais la coque autour de la page n'y ajoute ni notification, ni compteur, ni liste des associés.
 */
const state = vi.hoisted(() => ({ mustEnrol: true }));
const getShellDataFor = vi.hoisted(() =>
  vi.fn(async () => ({ counters: { support: 3 }, notifications: [] })),
);

vi.mock("@/server/auth/session", () => ({
  requireInternalActor: async () => ({
    userId: "u",
    role: "admin",
    name: "A",
    email: "a@test.local",
  }),
  mustEnrolTwoFactor: async () => state.mustEnrol,
}));
vi.mock("@/modules/platform/shell.service", () => ({ getShellDataFor }));
vi.mock("@/modules/admin/admin.actions", () => ({ saveThemeAction: async () => undefined }));
vi.mock("@/modules/dashboard/dashboard.actions", () => ({
  globalSearchAction: async () => [],
}));

const { default: AppLayout } = await import("@/app/(app)/layout");

describe("coque de l'application", () => {
  beforeEach(() => getShellDataFor.mockClear());

  it("ne lit aucune donnée pour un compte à enrôler", async () => {
    state.mustEnrol = true;
    await AppLayout({ children: null });
    expect(getShellDataFor).not.toHaveBeenCalled();
  });

  it("lit la coque d'un compte en règle", async () => {
    state.mustEnrol = false;
    await AppLayout({ children: null });
    expect(getShellDataFor).toHaveBeenCalledOnce();
  });
});
