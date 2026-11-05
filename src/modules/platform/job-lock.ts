import type { Pool } from "pg";
import type { JobLock } from "./jobs.service";

/**
 * Verrou consultatif de session, sur une connexion réservée : il se libère seul si le processus
 * tombe. Un second lancement de la même tâche ne l'attend pas, il renonce.
 */
export function createAdvisoryJobLock(pool: Pool): JobLock {
  return async (name, run) => {
    const client = await pool.connect();
    try {
      const key = `nuera-job:${name}`;
      const { rows } = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtext($1)) as locked",
        [key],
      );
      if (!rows[0]?.locked) return false;
      try {
        await run();
        return true;
      } finally {
        await client.query("select pg_advisory_unlock(hashtext($1))", [key]);
      }
    } finally {
      client.release();
    }
  };
}
