/**
 * Schéma de données de Nuera OS, un fichier par domaine, conforme à `docs/domain-model.md` §3.
 * Toute modification passe par une migration : `npm run db:generate` puis relecture du SQL.
 *
 * Valeurs fermées : `src/lib/domain-enums.ts`, réexporté ici pour les services et les dépôts.
 * L'interface les importe directement depuis `@/lib/domain-enums`.
 *
 * Pas de `relations()` Drizzle : les dépôts écrivent des jointures explicites.
 */
export * from "../../../lib/domain-enums";
export * from "./auth";
export * from "./audit";
export * from "./crm";
export * from "./sales";
export * from "./projects";
export * from "./team";
export * from "./sites";
export * from "./contracts";
export * from "./support";
export * from "./finance";
export * from "./documents";
export * from "./messaging";
export * from "./portal";
export * from "./platform";
