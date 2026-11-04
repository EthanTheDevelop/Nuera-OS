import "server-only";
import { getEnv } from "@/server/config/env";
import { IntegrationUnavailableError, type CrmGateway } from "./crm-gateway";
import { TwentyClient } from "./twenty.client";
import { TwentyCrmGateway } from "./twenty.gateway";

export * from "./crm-gateway";

/** Sans configuration : tout appel échoue, aucun succès simulé. */
function createUnconfiguredGateway(): CrmGateway {
  return new Proxy({ isConfigured: false } as CrmGateway, {
    get(target, property) {
      if (property === "isConfigured") return false;
      // Un objet renvoyé par une fonction async est testé comme « thenable » : ne pas le simuler.
      if (typeof property === "symbol" || property === "then") return Reflect.get(target, property);
      return () => Promise.reject(new IntegrationUnavailableError("not_configured"));
    },
  });
}

let cached: CrmGateway | undefined;

/** Passerelle CRM de l'application (`isConfigured` à `false` si la connexion n'est pas définie). */
export function getCrmGateway(): CrmGateway {
  if (cached) return cached;
  const { TWENTY_API_URL, TWENTY_API_KEY } = getEnv();
  cached =
    TWENTY_API_URL && TWENTY_API_KEY
      ? new TwentyCrmGateway(new TwentyClient({ baseUrl: TWENTY_API_URL, apiKey: TWENTY_API_KEY }))
      : createUnconfiguredGateway();
  return cached;
}
