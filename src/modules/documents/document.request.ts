import "server-only";
import { resolvePortalContext } from "@/server/auth/portal-context";
import { isInternalRole } from "@/server/auth/roles";
import { getCurrentActor } from "@/server/auth/session";
import type { PortalContext, ServiceContext } from "@/server/context";
import { getDb } from "@/server/db/client";
import { UnauthenticatedError } from "@/server/errors";

export type RequestContext =
  { kind: "staff"; ctx: ServiceContext } | { kind: "portal"; ctx: PortalContext };

/**
 * Contexte d'une route de documents, ouverte à l'équipe comme au portail, selon le rôle. Sans
 * session : 401. Adhésion révoquée : refus.
 */
export async function resolveRequestContext(): Promise<RequestContext> {
  const actor = await getCurrentActor();
  if (!actor) throw new UnauthenticatedError();
  const db = getDb();
  if (isInternalRole(actor.role)) return { kind: "staff", ctx: { db, actor } };
  return { kind: "portal", ctx: await resolvePortalContext(db, actor) };
}
