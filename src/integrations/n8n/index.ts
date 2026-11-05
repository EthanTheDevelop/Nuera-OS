import "server-only";
import { getEnv } from "@/server/config/env";
import { N8nClient, unconfiguredN8nGateway, type N8nGateway } from "./n8n.client";

export * from "./n8n.client";

/** Passerelle configurée par l'environnement. Sans URL ni secret : `isConfigured` vaut `false`. */
export function getN8nGateway(): N8nGateway {
  const { N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET, N8N_WEBHOOK_HEADER_TOKEN } = getEnv();
  return N8N_WEBHOOK_URL && N8N_WEBHOOK_SECRET
    ? new N8nClient({
        url: N8N_WEBHOOK_URL,
        secret: N8N_WEBHOOK_SECRET,
        headerToken: N8N_WEBHOOK_HEADER_TOKEN,
      })
    : unconfiguredN8nGateway;
}
