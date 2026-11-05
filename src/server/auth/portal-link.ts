import "server-only";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/types";
import { buildAuth } from "./auth";
import { PORTAL_LINK_CALLBACKS, type PortalLinkIssuer } from "./magic-link";

/**
 * Émet un lien de connexion et le rend à l'appelant au lieu de l'envoyer, pour l'e-mail d'invitation
 * (C1) et le lien à copier. Une instance dédiée, dont l'envoi capture le lien : la route publique
 * garde la sienne, qui ne peut rien renvoyer. Le filtre sur l'adhésion et le jeton sont les mêmes.
 */
export function createPortalLinkIssuer(options: {
  db: Database;
  secret: string;
  baseURL: string;
}): PortalLinkIssuer {
  return async (email) => {
    let url: string | null = null;
    const auth = buildAuth({
      ...options,
      sendMagicLink: async (mail) => {
        url = mail.url;
      },
    });
    await auth.api.signInMagicLink({
      body: { email, ...PORTAL_LINK_CALLBACKS },
      headers: new Headers({ origin: options.baseURL }),
    });
    return url;
  };
}

export const issuePortalLink: PortalLinkIssuer = (email) => {
  const env = getEnv();
  return createPortalLinkIssuer({
    db: getDb(),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  })(email);
};
