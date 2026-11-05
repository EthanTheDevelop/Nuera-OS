/**
 * Garde-fous du jeu de données STAGING. Purs, sans accès réseau : testés seuls.
 *
 * Deux verrous indépendants, tous deux obligatoires :
 *   1. `SEED_ALLOWED` vaut exactement `true` ;
 *   2. la base visée s'appelle exactement `nuera_os_staging`, dans `DATABASE_URL` puis selon
 *      PostgreSQL lui-même (`current_database()`), une fois connecté.
 *
 * `NODE_ENV` n'est jamais consulté : l'image de staging tourne en `production`.
 */

export const STAGING_DATABASE_NAME = "nuera_os_staging";

export interface StagingGuardInput {
  databaseUrl: string | undefined;
  seedAllowed: string | undefined;
}

/** Nom de base lu dans l'URL, décodé, ou `null` s'il est absent ou illisible. */
export function databaseNameFromUrl(databaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
  const path = url.pathname.replace(/^\//, "");
  if (!path || path.includes("/")) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/** Motif du refus avant toute connexion, ou `null` si l'exécution est autorisée. */
export function stagingSeedRefusalReason(input: StagingGuardInput): string | null {
  if (input.seedAllowed !== "true") {
    return "SEED_ALLOWED doit valoir exactement « true » pour autoriser le jeu de données staging.";
  }
  if (!input.databaseUrl) return "DATABASE_URL est absente.";
  const name = databaseNameFromUrl(input.databaseUrl);
  if (name === null) {
    return "DATABASE_URL ne désigne aucune base PostgreSQL lisible (postgres://…/nuera_os_staging).";
  }
  // Paramètres de connexion qui changeraient la base effective sans changer le chemin de l'URL.
  const params = new URL(input.databaseUrl).searchParams;
  for (const key of ["dbname", "database", "options"]) {
    if (params.has(key)) return `DATABASE_URL ne doit pas porter le paramètre « ${key} ».`;
  }
  if (name !== STAGING_DATABASE_NAME) {
    return `Base « ${name} » refusée : seule « ${STAGING_DATABASE_NAME} » est acceptée.`;
  }
  return null;
}

/** Second verrou, après connexion : le nom réel de la base, selon PostgreSQL. */
export function connectedDatabaseRefusalReason(currentDatabase: string | null): string | null {
  if (currentDatabase !== STAGING_DATABASE_NAME) {
    return `Connecté à « ${currentDatabase ?? "inconnue"} » : seule « ${STAGING_DATABASE_NAME} » est acceptée.`;
  }
  return null;
}
