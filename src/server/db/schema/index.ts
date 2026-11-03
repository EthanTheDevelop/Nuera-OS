/**
 * Schéma de données de Nuera OS, un fichier par domaine.
 *
 * État initial : uniquement l'infrastructure (authentification, journal d'audit).
 * Les tables métier seront ajoutées module par module, à partir des spécifications
 * validées (voir docs/architecture.md § Modèle de données).
 * Toute modification passe par une migration : `npm run db:generate` puis revue du SQL.
 */
export * from "./auth";
export * from "./audit";
