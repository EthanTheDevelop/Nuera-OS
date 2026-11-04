/**
 * Rôles applicatifs — source de vérité unique (contrainte CHECK SQL, better-auth, RBAC).
 * Voir `docs/domain-model.md` §5.
 *
 * Ajouter un rôle = l'ajouter ici + matrice de permissions + migration.
 */
export const ROLES = ["admin", "member", "contractor", "viewer", "client"] as const;
export type Role = (typeof ROLES)[number];

/** Rôles de l'équipe : tout sauf `client`, qui n'accède qu'au portail. */
export const INTERNAL_ROLES = ["admin", "member", "contractor", "viewer"] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

/** Rôle attribué par défaut à un nouveau compte (moindre privilège : lecture seule). */
export const DEFAULT_ROLE: Role = "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Associé",
  member: "Collaborateur",
  contractor: "Prestataire",
  viewer: "Lecture",
  client: "Portail",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isInternalRole(value: unknown): value is InternalRole {
  return typeof value === "string" && (INTERNAL_ROLES as readonly string[]).includes(value);
}
