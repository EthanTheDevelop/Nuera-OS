import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";

/**
 * Client better-auth pour le navigateur (connexion, second facteur, déconnexion).
 * Créé à la demande : l'URL de base est l'origine de la page (même domaine que l'API).
 * Passer par l'API HTTP `/api/auth/*` garantit l'application de la limitation de débit.
 */
function createClient() {
  return createAuthClient({
    baseURL: window.location.origin,
    plugins: [twoFactorClient()],
  });
}

let client: ReturnType<typeof createClient> | undefined;

export function getAuthClient() {
  client ??= createClient();
  return client;
}
