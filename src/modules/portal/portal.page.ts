import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getTicketForPortal } from "@/modules/support/ticket.service";
import { getCurrentActor, getPortalContext } from "@/server/auth/session";
import type { PortalContext } from "@/server/context";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getPortalHome, type PortalHome } from "./portal.service";

export const SELECTED_PROJECT_COOKIE = "nuera-portal-project";

/**
 * Point d'entrée de chaque page du portail. Sans session : page de connexion du client. Membre de
 * l'équipe : retour à l'agence (`getPortalContext`). Adhésion révoquée ou absente : page d'accès
 * retiré, à la requête même où la révocation est constatée.
 */
export const requirePortalPage = cache(async (): Promise<PortalContext> => {
  const actor = await getCurrentActor();
  if (!actor) redirect("/espace/connexion");
  try {
    return await getPortalContext();
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/espace/acces-retire");
    throw error;
  }
});

/** Données de la capsule et de C3, lues une fois par requête. */
export const loadPortalHome = cache(async (): Promise<PortalHome> => {
  const ctx = await requirePortalPage();
  const store = await cookies();
  return getPortalHome(ctx, { selectedProjectId: store.get(SELECTED_PROJECT_COOKIE)?.value });
});

/** La demande de ce client, une fois par requête. Toute autre : 404. */
export const loadPortalTicket = cache(async (ticketId: string) => {
  const ctx = await requirePortalPage();
  return orNotFound(() => getTicketForPortal(ctx, ticketId));
});

/** Un objet hors périmètre est une vraie page 404. */
export async function orNotFound<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
