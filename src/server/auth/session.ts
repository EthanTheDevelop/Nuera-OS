import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getCrmGateway } from "@/integrations/twenty";
import { isTwoFactorRequired } from "@/modules/platform/settings.service";
import { getEnv } from "@/server/config/env";
import type { PortalContext, ServiceContext } from "@/server/context";
import { getDb } from "@/server/db/client";
import { ForbiddenError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getAuth } from "./auth";
import type { Actor } from "./permissions";
import { resolvePortalContext } from "./portal-context";
import { isInternalRole, isRole } from "./roles";

/**
 * Utilisateur courant, résolu une seule fois par requête (`cache`).
 * La session est vérifiée en base à chaque requête (pas de cache cookie) :
 * une désactivation de compte ou une révocation de session est immédiate.
 */
const loadSession = cache(async () => {
  // Lire la requête AVANT tout le reste : rend la route dynamique (jamais pré-rendue
  // au build) et évite d'exiger la configuration serveur pendant `next build`.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** Identifiant de la session courante : marque « cette session » dans le profil. */
export async function getCurrentSessionId(): Promise<string | null> {
  return (await loadSession())?.session.id ?? null;
}

export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const session = await loadSession();
  if (!session) return null;

  const { user } = session;
  if (!isRole(user.role)) {
    // Impossible en principe (contrainte CHECK en base) : on refuse par défaut.
    logger.error("auth.invalid_role", { userId: user.id });
    throw new ForbiddenError(
      "Votre compte n'est pas correctement configuré. Contactez un administrateur.",
    );
  }
  return { userId: user.id, role: user.role, name: user.name, email: user.email };
});

/** Exige une session ; sinon redirige vers la page de connexion. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  return actor;
}

/** Page d'enrôlement : jamais verrouillée, sinon personne ne pourrait s'y mettre en règle. */
export const TWO_FACTOR_ENROLMENT_PATH = "/profil?double-authentification=requise#securite";

const mustEnrolTwoFactor = cache(async (): Promise<boolean> => {
  const session = await loadSession();
  if (!session || session.user.twoFactorEnabled) return false;
  return isTwoFactorRequired(getDb(), getEnv().NODE_ENV);
});

/**
 * Exige un membre de l'équipe : tout rôle sauf `client`.
 * Un client qui ouvre une URL interne part vers son espace (`docs/domain-model.md` §5).
 * Si l'agence exige la double authentification et que le compte ne l'a pas : `/profil`. Seuls le
 * layout et `/profil` passent `allowTwoFactorEnrolment`.
 */
export async function requireInternalActor(
  options: { allowTwoFactorEnrolment?: boolean } = {},
): Promise<Actor> {
  const actor = await requireActor();
  if (!isInternalRole(actor.role)) redirect("/espace");
  if (!options.allowTwoFactorEnrolment && (await mustEnrolTwoFactor())) {
    redirect(TWO_FACTOR_ENROLMENT_PATH);
  }
  return actor;
}

/** Contexte de service de la requête courante : réservé à l'équipe, jamais à un client. */
export async function getServiceContext(): Promise<ServiceContext> {
  return { db: getDb(), actor: await requireInternalActor(), crm: getCrmGateway() };
}

/** Contexte de `/profil` : le seul endroit ouvert à un compte qui doit encore s'enrôler. */
export async function getEnrolmentServiceContext(): Promise<ServiceContext> {
  return {
    db: getDb(),
    actor: await requireInternalActor({ allowTwoFactorEnrolment: true }),
    crm: getCrmGateway(),
  };
}

/**
 * Contexte du portail pour la requête courante. Sans session : page de connexion. Membre de
 * l'équipe : retour à l'agence. Adhésion absente ou révoquée : `ForbiddenError`.
 */
export const getPortalContext = cache(async (): Promise<PortalContext> => {
  const actor = await requireActor();
  if (isInternalRole(actor.role)) redirect("/");
  return resolvePortalContext(getDb(), actor);
});
