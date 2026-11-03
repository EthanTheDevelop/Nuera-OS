/**
 * Exécuté une fois au démarrage du serveur Next.js (pas pendant le build).
 * - Valide la configuration : le serveur refuse de démarrer si elle est invalide.
 * - Applique les migrations si `DB_MIGRATE_ON_START=true` (déploiement Coolify).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("@/server/config/env");
  const { logger } = await import("@/server/logger");

  let env;
  try {
    env = getEnv();
  } catch (error) {
    logger.error("startup.invalid_configuration", { error });
    throw error;
  }

  if (env.DB_MIGRATE_ON_START) {
    const { runMigrations } = await import("@/server/db/migrate");
    const { getPool } = await import("@/server/db/client");
    await runMigrations(getPool());
  }

  logger.info("startup.ready", { nodeEnv: env.NODE_ENV });
}
