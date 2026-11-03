/**
 * Rôles applicatifs — source de vérité unique (contrainte CHECK SQL, better-auth, RBAC).
 *
 * Jeu MINIMAL de départ, à définir avec le métier : `admin` administre la plateforme,
 * `member` est un collaborateur sans droit particulier tant qu'aucun module n'existe.
 * Ajouter un rôle = l'ajouter ici + matrice de permissions + migration.
 */
export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/** Rôle attribué par défaut à un nouveau compte (moindre privilège). */
export const DEFAULT_ROLE: Role = "member";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur",
  member: "Collaborateur",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
