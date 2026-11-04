import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { assertSiteExists } from "@/modules/sites/site.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError, ValidationError } from "@/server/errors";

/**
 * Vérifie le site au-dessus de `loading.tsx` : une fois le squelette envoyé, la réponse resterait en
 * 200. Un site inconnu répond donc un vrai 404. La page refait le contrôle à travers le service.
 */
export default async function SiteLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const ctx = await getServiceContext();
  if (can(ctx.actor, "sites:read")) {
    const { id } = await params;
    try {
      await assertSiteExists(ctx, id);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
      throw error;
    }
  }
  return children;
}
