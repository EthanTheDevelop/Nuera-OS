import "server-only";
import { getEnv } from "@/server/config/env";
import { logger } from "@/server/logger";

/**
 * Démarrage du serveur (appelé par `src/instrumentation.ts`) :
 * - valide la configuration : le serveur refuse de démarrer si elle est invalide ;
 * - applique les migrations si `DB_MIGRATE_ON_START=true` (déploiement Coolify).
 *
 * Toute erreur arrête le processus (code 1). Next.js se contente sinon de la
 * journaliser et continue de servir : un conteneur mal configuré, ou dont les
 * migrations ont échoué, pourrait alors être déclaré sain et remplacer l'ancien.
 */
export async function startServer(): Promise<void> {
  let env;
  try {
    env = getEnv();
  } catch (error) {
    logger.error("startup.invalid_configuration", { error });
    process.exit(1);
  }

  if (env.DB_MIGRATE_ON_START) {
    try {
      const { runMigrations } = await import("@/server/db/migrate");
      const { getPool } = await import("@/server/db/client");
      await runMigrations(getPool());
    } catch (error) {
      logger.error("startup.migrations_failed", { error });
      process.exit(1);
    }
  }

  logger.info("startup.ready", { nodeEnv: env.NODE_ENV });
}
