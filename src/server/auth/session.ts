import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { ServiceContext } from "@/server/context";
import { getDb } from "@/server/db/client";
import { ForbiddenError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getAuth } from "./auth";
import type { Actor } from "./permissions";
import { isRole } from "./roles";

/**
 * Utilisateur courant, résolu une seule fois par requête (`cache`).
 * La session est vérifiée en base à chaque requête (pas de cache cookie) :
 * une désactivation de compte ou une révocation de session est immédiate.
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  // Lire la requête AVANT tout le reste : rend la route dynamique (jamais pré-rendue
  // au build) et évite d'exiger la configuration serveur pendant `next build`.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
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

/** Contexte de service de la requête courante (utilisateur connecté obligatoire). */
export async function getServiceContext(): Promise<ServiceContext> {
  return { db: getDb(), actor: await requireActor() };
}
