import "server-only";
import { getEnv } from "@/server/config/env";
import { docusealNotConfigured, DocusealClient, type DocusealGateway } from "./docuseal.client";

export * from "./docuseal.client";

/** Sans configuration, tout appel échoue : aucun succès simulé. */
const UNCONFIGURED: DocusealGateway = {
  isConfigured: false,
  createSubmission: () => Promise.reject(docusealNotConfigured()),
  getSubmission: () => Promise.reject(docusealNotConfigured()),
  getSubmissionDocuments: () => Promise.reject(docusealNotConfigured()),
  archiveSubmission: () => Promise.reject(docusealNotConfigured()),
};

let cached: DocusealGateway | undefined;

/** Passerelle de l'application. `isConfigured` vaut `false` si la connexion n'est pas définie. */
export function getDocusealGateway(): DocusealGateway {
  if (cached) return cached;
  const { DOCUSEAL_API_URL, DOCUSEAL_API_KEY } = getEnv();
  cached =
    DOCUSEAL_API_URL && DOCUSEAL_API_KEY
      ? new DocusealClient({ baseUrl: DOCUSEAL_API_URL, apiKey: DOCUSEAL_API_KEY })
      : UNCONFIGURED;
  return cached;
}

export function isDocusealConfigured(): boolean {
  return getDocusealGateway().isConfigured;
}

/** Secret `whsec_…` de l'onglet HMAC du webhook, ou `null` si absent : le webhook est alors refusé. */
export function getDocusealWebhookSecret(): string | null {
  return getEnv().DOCUSEAL_WEBHOOK_SECRET ?? null;
}
