import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";

/** Vérifie que la base répond (utilisé par le healthcheck Coolify / Docker). */
export async function checkDatabase(timeoutMs = 2_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Délai dépassé")), timeoutMs);
      }),
    ]);
    return true;
  } catch (error) {
    logger.error("health.database_unavailable", { error });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
