import { ForbiddenError } from "@/server/errors";
import { isRole, type Role } from "./roles";

/**
 * Contrôle d'accès par rôles (RBAC) — matrice centralisée, refus par défaut.
 *
 * Convention : `domaine:action`. Chaque module métier déclarera ici ses permissions
 * (ex. `companies:read`) et les attribuera explicitement aux rôles.
 * Les permissions sont vérifiées CÔTÉ SERVEUR dans les services ; l'interface ne
 * s'en sert que pour masquer ce qui n'est pas accessible.
 *
 * Permissions initiales : uniquement celles de l'infrastructure existante.
 */
export const PERMISSIONS = ["users:manage", "audit:read"] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  member: [],
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

export function assertCan(
  actor: Pick<Actor, "role"> | null | undefined,
  permission: Permission,
): void {
  if (!can(actor, permission)) throw new ForbiddenError();
}
