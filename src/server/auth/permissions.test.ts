import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/errors";
import { assertCan, can, hasPermission, PERMISSIONS, permissionsFor } from "./permissions";
import { ROLES } from "./roles";

describe("RBAC", () => {
  it("accorde toutes les permissions à l'administrateur", () => {
    expect(permissionsFor("admin")).toEqual(PERMISSIONS);
  });

  it("n'accorde rien par défaut au collaborateur", () => {
    for (const permission of PERMISSIONS) expect(hasPermission("member", permission)).toBe(false);
  });

  it("refuse un rôle inconnu ou absent", () => {
    expect(hasPermission("superadmin", "audit:read")).toBe(false);
    expect(hasPermission(undefined, "audit:read")).toBe(false);
    expect(can(null, "audit:read")).toBe(false);
  });

  it("lève une ForbiddenError quand la permission manque", () => {
    expect(() => assertCan({ role: "member" }, "users:manage")).toThrow(ForbiddenError);
    expect(() => assertCan({ role: "admin" }, "users:manage")).not.toThrow();
  });

  it("définit une matrice pour chaque rôle", () => {
    for (const role of ROLES) expect(Array.isArray(permissionsFor(role))).toBe(true);
  });
});
