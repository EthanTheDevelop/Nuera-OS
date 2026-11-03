import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Schema = typeof schema;

/**
 * Type de base de données accepté par les dépôts et services.
 * Volontairement générique (indépendant du driver) : `node-postgres` en exécution,
 * PGlite dans les tests. Une transaction (`tx`) est aussi un `Database`.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;
