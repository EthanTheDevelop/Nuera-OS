import type { Actor } from "@/server/auth/permissions";
import type { Database } from "@/server/db/types";

/**
 * Contexte passé explicitement à chaque fonction de service.
 * Pas de conteneur d'injection : la base et l'acteur sont des paramètres,
 * ce qui rend les services testables sans Next.js (cf. tests PGlite).
 */
export interface ServiceContext {
  db: Database;
  actor: Actor;
}
