import type { ReactNode } from "react";
import { loadPortalTicket, requirePortalPage } from "@/modules/portal/portal.page";

/**
 * Lit la demande avant le `loading.tsx` de la page : hors périmètre, la réponse est un vrai 404 HTTP,
 * pas un 200 suivi d'une page d'erreur.
 */
export default async function PortalTicketLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  await requirePortalPage();
  const { id } = await params;
  await loadPortalTicket(id);
  return children;
}
