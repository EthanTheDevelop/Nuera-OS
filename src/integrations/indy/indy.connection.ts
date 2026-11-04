import type { IntegrationStatus } from "@/lib/domain-enums";
import { ServiceUnavailableError } from "@/server/errors";

/**
 * État de la connexion à Indy (arbitrage A11). Recherche faite le 2026-11-04 sur indy.fr et sur son
 * centre d'aide wikicompta.indy.fr : aucune API publique documentée. On ne l'invente pas : l'adaptateur
 * n'appelle rien, et le chemin réel est l'import CSV et la saisie manuelle des références.
 */
export const INDY_SERVICE = "indy" as const;

/** Application Indy, ouverte dans un nouvel onglet par « Ouvrir Indy ». Aucun appel serveur. */
export const INDY_APP_URL = "https://app.indy.fr/connexion/";

/** `to_verify` : libellé « API à vérifier », tant qu'Indy n'a pas confirmé d'accès. */
export const INDY_CONNECTION_STATUS: IntegrationStatus = "to_verify";

export function isIndyApiConfigured(): boolean {
  return false;
}

/** Point d'entrée de toute future lecture par API : jamais de succès simulé. */
export function assertIndyApiAvailable(): void {
  throw new ServiceUnavailableError(
    INDY_SERVICE,
    "not_configured",
    "Connexion requise : aucune API Indy n'a été vérifiée. Importez un fichier CSV ou saisissez les références à la main.",
  );
}
