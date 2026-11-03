import { createAuthClient } from "better-auth/client";

/**
 * Client better-auth pour le navigateur (connexion / déconnexion).
 * Créé à la demande : l'URL de base est l'origine de la page (même domaine que l'API).
 * Passer par l'API HTTP `/api/auth/*` garantit l'application de la limitation de débit.
 */
let client: ReturnType<typeof createAuthClient> | undefined;

export function getAuthClient() {
  client ??= createAuthClient({ baseURL: window.location.origin });
  return client;
}
