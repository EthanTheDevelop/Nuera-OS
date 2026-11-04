import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/errors";
import {
  assertCan,
  assertCanAny,
  can,
  canAny,
  hasPermission,
  isInternalRole,
  PERMISSIONS,
  permissionsFor,
  type Permission,
} from "./permissions";
import { DEFAULT_ROLE, ROLE_LABELS, ROLES, type Role } from "./roles";

describe("RBAC", () => {
  it("accorde toutes les permissions à l'administrateur", () => {
    expect(permissionsFor("admin")).toEqual(PERMISSIONS);
  });

  it("n'accorde aucune permission interne au client", () => {
    expect(permissionsFor("client")).toEqual([]);
    for (const permission of PERMISSIONS) expect(hasPermission("client", permission)).toBe(false);
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

  it("ne distribue que des permissions déclarées, sans doublon", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const role of ROLES) {
      const granted = permissionsFor(role);
      expect(new Set(granted).size).toBe(granted.length);
      for (const permission of granted) expect(PERMISSIONS).toContain(permission);
    }
  });

  it("couvre tous les domaines du contrat", () => {
    const domains = new Set(PERMISSIONS.map((permission) => permission.split(":")[0]));
    expect([...domains].sort()).toEqual(
      [
        "crm",
        "sales",
        "quotes",
        "catalog",
        "projects",
        "tasks",
        "time",
        "team",
        "sites",
        "deployments",
        "contracts",
        "support",
        "finance",
        "documents",
        "knowledge",
        "messages",
        "automations",
        "admin",
        "users",
        "audit",
        "integrations",
        "dashboard",
        "export",
      ].sort(),
    );
  });
});

describe("matrice du contrat (§5)", () => {
  // Table complète : toute permission ajoutée doit être attribuée ici, sinon le test échoue.
  const MATRIX: Record<Permission, readonly Role[]> = {
    "crm:read": ["admin", "member", "viewer"],
    "crm:create": ["admin", "member"],
    "crm:update": ["admin", "member"],
    "crm:archive": ["admin", "member"],
    "crm:merge": ["admin"],
    "sales:read": ["admin", "member", "viewer"],
    "sales:create": ["admin", "member"],
    "sales:update": ["admin", "member"],
    "sales:reopen": ["admin"],
    "quotes:read": ["admin", "member", "viewer"],
    "quotes:create": ["admin", "member"],
    "quotes:update": ["admin", "member"],
    "quotes:send": ["admin", "member"],
    "catalog:read": ["admin", "member", "viewer"],
    "catalog:manage": ["admin"],
    "projects:read": ["admin", "member", "viewer"],
    "projects:read_assigned": ["admin", "contractor"],
    "projects:create": ["admin", "member"],
    "projects:update": ["admin", "member"],
    "projects:archive": ["admin", "member"],
    "tasks:read": ["admin", "member", "viewer"],
    "tasks:read_assigned": ["admin", "contractor"],
    "tasks:create": ["admin", "member"],
    "tasks:update": ["admin", "member"],
    "tasks:update_assigned": ["admin", "contractor"],
    "time:read": ["admin", "member", "viewer"],
    "time:create_own": ["admin", "member", "contractor"],
    "time:manage": ["admin"],
    "team:read": ["admin", "member", "viewer"],
    "team:read_costs": ["admin"],
    "team:manage": ["admin"],
    "sites:read": ["admin", "member", "viewer"],
    "sites:create": ["admin", "member"],
    "sites:update": ["admin", "member"],
    "sites:archive": ["admin", "member"],
    "deployments:read": ["admin", "member", "viewer"],
    "deployments:trigger": ["admin"],
    "contracts:read": ["admin", "member", "viewer"],
    "contracts:create": ["admin", "member"],
    "contracts:update": ["admin", "member"],
    "contracts:terminate": ["admin"],
    "support:read": ["admin", "member", "viewer"],
    "support:read_assigned": ["admin", "contractor"],
    "support:create": ["admin", "member"],
    "support:update": ["admin", "member"],
    "finance:read": ["admin"],
    "finance:manage": ["admin"],
    "documents:read": ["admin", "member", "viewer"],
    "documents:read_assigned": ["admin", "contractor"],
    "documents:create": ["admin", "member"],
    "documents:update": ["admin", "member"],
    "knowledge:read": ["admin", "member", "viewer"],
    "knowledge:manage": ["admin", "member"],
    "messages:read": ["admin", "member", "viewer"],
    "messages:send": ["admin", "member"],
    "automations:read": ["admin", "member"],
    "automations:manage": ["admin"],
    "admin:read": ["admin"],
    "admin:manage": ["admin"],
    "users:manage": ["admin"],
    "audit:read": ["admin"],
    "integrations:read": ["admin", "member"],
    "integrations:manage": ["admin"],
    "dashboard:read": ["admin", "member", "viewer"],
    "export:run": ["admin"],
  };

  it("décrit chaque permission", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...PERMISSIONS].sort());
  });

  describe.each(ROLES)("rôle %s", (role) => {
    it.each(PERMISSIONS)("%s", (permission) => {
      expect(hasPermission(role, permission)).toBe(MATRIX[permission].includes(role));
    });
  });

  it("réserve à admin ce que le contrat nomme", () => {
    for (const permission of [
      "finance:read",
      "deployments:trigger",
      "users:manage",
      "export:run",
      "team:read_costs",
    ] as const) {
      expect(MATRIX[permission]).toEqual(["admin"]);
    }
  });

  it("donne au prestataire exactement la liste du contrat", () => {
    expect([...permissionsFor("contractor")].sort()).toEqual(
      [
        "projects:read_assigned",
        "tasks:read_assigned",
        "tasks:update_assigned",
        "time:create_own",
        "support:read_assigned",
        "documents:read_assigned",
      ].sort(),
    );
  });

  it("ne donne au rôle lecture que des permissions de lecture", () => {
    for (const permission of permissionsFor("viewer")) expect(permission).toMatch(/:read$/);
  });
});

describe("rôles", () => {
  it("distingue l'équipe du client, et refuse l'inconnu", () => {
    expect(ROLES.filter(isInternalRole)).toEqual(["admin", "member", "contractor", "viewer"]);
    expect(isInternalRole("client")).toBe(false);
    expect(isInternalRole("superadmin")).toBe(false);
    expect(isInternalRole(undefined)).toBe(false);
  });

  it("propose un libellé par rôle", () => {
    for (const role of ROLES) expect(ROLE_LABELS[role]).toBeTruthy();
    expect(ROLE_LABELS.admin).toBe("Associé");
    expect(ROLE_LABELS.client).toBe("Portail");
  });

  it("donne le moindre privilège interne par défaut", () => {
    expect(DEFAULT_ROLE).toBe("viewer");
  });
});

describe("assertCanAny", () => {
  it("accepte l'une des permissions et refuse par défaut", () => {
    const scope = ["projects:read", "projects:read_assigned"] as const;
    expect(canAny({ role: "contractor" }, scope)).toBe(true);
    expect(canAny({ role: "client" }, scope)).toBe(false);
    expect(canAny(null, scope)).toBe(false);
    expect(() => assertCanAny({ role: "viewer" }, scope)).not.toThrow();
    expect(() => assertCanAny({ role: "client" }, scope)).toThrow(ForbiddenError);
  });
});
