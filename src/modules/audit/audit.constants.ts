/**
 * Catalogue des opérations journalisées. Identifiant = `entité.événement`.
 * Chaque module ajoute ici ses opérations importantes (création, modification
 * sensible, changement de droits, archivage, export, appel d'intégration critique…).
 */
export const AUDIT_ACTIONS = {
  "auth.signed_in": "Connexion",
  "user.created": "Utilisateur créé",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_ENTITY_TYPES = ["user"] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
