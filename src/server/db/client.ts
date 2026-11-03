import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/config/env";
import { logger } from "@/server/logger";
import * as schema from "./schema";
import type { Database } from "./types";

interface DbHandle {
  pool: Pool;
  db: Database;
}

// En développement, le rechargement à chaud réévalue les modules : on conserve
// le pool sur `globalThis` pour ne pas ouvrir une nouvelle série de connexions.
const globalForDb = globalThis as typeof globalThis & { __nueraDb?: DbHandle };

function createHandle(): DbHandle {
  const env = getEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    application_name: "nuera-os",
  });
  pool.on("error", (error) => logger.error("db.pool_error", { error }));
  return { pool, db: drizzle(pool, { schema }) };
}

function getHandle(): DbHandle {
  globalForDb.__nueraDb ??= createHandle();
  return globalForDb.__nueraDb;
}

/** Instance Drizzle partagée (créée à la première utilisation). */
export function getDb(): Database {
  return getHandle().db;
}

export function getPool(): Pool {
  return getHandle().pool;
}

/** Ferme le pool (scripts CLI). */
export async function closeDb(): Promise<void> {
  const handle = globalForDb.__nueraDb;
  if (!handle) return;
  globalForDb.__nueraDb = undefined;
  await handle.pool.end();
}
