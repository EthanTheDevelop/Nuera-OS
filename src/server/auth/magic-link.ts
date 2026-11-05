import { and, eq, inArray } from "drizzle-orm";
import { enqueueEmail } from "@/modules/platform/email-outbox";
import { portalMemberships, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/** Durée de validité d'un lien de connexion client (écrans C1, C2, C9). */
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 60 * 60 * 24;

export interface MagicLinkMail {
  email: string;
  url: string;
}

/** Point d'injection de l'envoi : l'adaptateur SMTP ou un test remplace ce dépôt dans la boîte. */
export type MagicLinkSender = (mail: MagicLinkMail) => Promise<void>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Par défaut : le lien part dans `email_outbox`, à charge pour l'adaptateur SMTP de l'expédier. */
export function createOutboxMagicLinkSender(db: Database): MagicLinkSender {
  return async ({ email, url }) => {
    const text = [
      "Bonjour,",
      "",
      "Voici votre lien de connexion à votre espace Nuera :",
      url,
      "",
      "Pas de mot de passe à retenir : ce lien vous connecte directement. Il reste valable 24 heures.",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    ].join("\n");
    const html = [
      "<p>Bonjour,</p>",
      `<p><a href="${escapeHtml(url)}">Accéder à mon espace</a></p>`,
      "<p>Pas de mot de passe à retenir : ce lien vous connecte directement. Il reste valable 24 heures.</p>",
      "<p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>",
    ].join("");
    await enqueueEmail(db, {
      to: email,
      subject: "Votre lien de connexion à votre espace Nuera",
      text,
      html,
      template: "portal_magic_link",
    });
  };
}

/**
 * Filtre de l'envoi : un lien ne part que vers un client au `portal_memberships` valide.
 *
 * Sans ce filtre, un membre de l'équipe qui demande un lien contournerait son mot de passe et sa
 * double authentification. L'absence d'envoi reste silencieuse : la réponse HTTP est la même, pour
 * ne pas révéler si une adresse existe (écran C2).
 */
export async function sendMagicLinkToPortalClient(
  db: Database,
  send: MagicLinkSender,
  mail: MagicLinkMail,
): Promise<void> {
  const [eligible] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(portalMemberships, eq(portalMemberships.userId, users.id))
    .where(
      and(
        eq(users.email, mail.email.trim().toLowerCase()),
        eq(users.role, "client"),
        eq(users.banned, false),
        inArray(portalMemberships.status, ["invited", "active"]),
      ),
    )
    .limit(1);
  if (eligible) await send(mail);
}

/** Émet un lien sans l'envoyer. `null` : l'adresse n'a pas d'adhésion valide, aucun lien n'existe. */
export type PortalLinkIssuer = (email: string) => Promise<string | null>;

/** Destination commune d'un lien de connexion client, et page du lien expiré (C9). */
export const PORTAL_LINK_CALLBACKS = {
  callbackURL: "/espace",
  errorCallbackURL: "/espace/lien-expire",
} as const;
