import "server-only";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { logger } from "@/server/logger";

/** Identifiant arbitraire mais fixe du verrou consultatif PostgreSQL des migrations. */
const MIGRATION_LOCK_ID = 727_001;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Applique les migrations SQL versionnées (`drizzle/`).
 * Un verrou consultatif empêche deux instances de migrer simultanément.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  const startedAt = Date.now();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    logger.info("db.migrations_applied", { durationMs: Date.now() - startedAt });
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch((error: unknown) => logger.warn("db.migration_unlock_failed", { error }));
    client.release();
  }
}
