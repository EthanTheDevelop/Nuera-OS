import { ForbiddenError } from "@/server/errors";
import { isInternalRole, isRole, type Role } from "./roles";

export { isInternalRole };

/**
 * Contrôle d'accès par rôles (RBAC) — matrice centralisée, refus par défaut.
 * Voir `docs/domain-model.md` §5.
 *
 * Convention : `domaine:action`. Les permissions sont vérifiées CÔTÉ SERVEUR dans les services ;
 * l'interface ne s'en sert que pour masquer ce qui n'est pas accessible.
 *
 * Une permission `*_assigned` ou `*_own` ne suffit pas : chaque service filtre dans sa requête sur
 * `project_members`, `missions` et `assignee_member_id`. Le rôle `client` n'a aucune permission
 * interne : il passe par `src/modules/portal` et un `PortalContext`.
 */
export const PERMISSIONS = [
  "crm:read",
  "crm:create",
  "crm:update",
  "crm:archive",
  "crm:merge",
  "sales:read",
  "sales:create",
  "sales:update",
  "sales:reopen",
  "quotes:read",
  "quotes:create",
  "quotes:update",
  "quotes:send",
  "catalog:read",
  "catalog:manage",
  "projects:read",
  "projects:read_assigned",
  "projects:create",
  "projects:update",
  "projects:archive",
  "tasks:read",
  "tasks:read_assigned",
  "tasks:create",
  "tasks:update",
  "tasks:update_assigned",
  "time:read",
  "time:create_own",
  "time:manage",
  "team:read",
  "team:read_costs",
  "team:manage",
  "sites:read",
  "sites:create",
  "sites:update",
  "sites:archive",
  "deployments:read",
  "deployments:trigger",
  "contracts:read",
  "contracts:create",
  "contracts:update",
  "contracts:terminate",
  "support:read",
  "support:read_assigned",
  "support:create",
  "support:update",
  "finance:read",
  "finance:manage",
  "documents:read",
  "documents:read_assigned",
  "documents:create",
  "documents:update",
  "knowledge:read",
  "knowledge:manage",
  "messages:read",
  "messages:send",
  "automations:read",
  "automations:manage",
  "admin:read",
  "admin:manage",
  "users:manage",
  "audit:read",
  "integrations:read",
  "integrations:manage",
  "dashboard:read",
  "export:run",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  member: [
    "crm:read",
    "crm:create",
    "crm:update",
    "crm:archive",
    "sales:read",
    "sales:create",
    "sales:update",
    "quotes:read",
    "quotes:create",
    "quotes:update",
    "quotes:send",
    "catalog:read",
    "projects:read",
    "projects:create",
    "projects:update",
    "projects:archive",
    "tasks:read",
    "tasks:create",
    "tasks:update",
    "time:read",
    "time:create_own",
    "team:read",
    "sites:read",
    "sites:create",
    "sites:update",
    "sites:archive",
    "deployments:read",
    "contracts:read",
    "contracts:create",
    "contracts:update",
    "support:read",
    "support:create",
    "support:update",
    "documents:read",
    "documents:create",
    "documents:update",
    "knowledge:read",
    "knowledge:manage",
    "messages:read",
    "messages:send",
    "automations:read",
    "integrations:read",
    "dashboard:read",
  ],
  contractor: [
    "projects:read_assigned",
    "tasks:read_assigned",
    "tasks:update_assigned",
    "time:create_own",
    "support:read_assigned",
    "documents:read_assigned",
  ],
  viewer: [
    "crm:read",
    "sales:read",
    "quotes:read",
    "catalog:read",
    "projects:read",
    "tasks:read",
    "time:read",
    "team:read",
    "sites:read",
    "deployments:read",
    "contracts:read",
    "support:read",
    "documents:read",
    "knowledge:read",
    "messages:read",
    "dashboard:read",
  ],
  client: [],
};

/** Utilisateur authentifié à l'origine d'une opération. */
export interface Actor {
  userId: string;
  role: Role;
  name: string;
  email: string;
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: unknown, permission: Permission): boolean {
  return isRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}

export function can(
  actor: Pick<Actor, "role"> | null | undefined,
  permission: Permission,
): boolean {
  return actor != null && hasPermission(actor.role, permission);
}

/** Vrai si l'acteur a au moins une des permissions (`projects:read` ou `projects:read_assigned`). */
export function canAny(
  actor: Pick<Actor, "role"> | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(actor, permission));
}

export function assertCan(
  actor: Pick<Actor, "role"> | null | undefined,
  permission: Permission,
): void {
  if (!can(actor, permission)) throw new ForbiddenError();
}

export function assertCanAny(
  actor: Pick<Actor, "role"> | null | undefined,
  permissions: readonly Permission[],
): void {
  if (!canAny(actor, permissions)) throw new ForbiddenError();
}
