/**
 * Exécuté une fois au démarrage du serveur Next.js (pas pendant le build).
 * La logique (configuration, migrations) est dans `src/server/startup.ts`,
 * chargée uniquement par le runtime Node.js.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startServer } = await import("@/server/startup");
    await startServer();
  }
}
