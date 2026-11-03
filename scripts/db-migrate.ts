/**
 * Applique les migrations en attente : `npm run db:migrate`.
 */
import { closeDb, getPool } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

try {
  await runMigrations(getPool());
  console.log("✔ Migrations appliquées.");
} catch (error) {
  console.error("✖ Échec des migrations :", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
