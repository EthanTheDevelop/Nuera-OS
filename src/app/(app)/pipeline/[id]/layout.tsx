import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getOpportunity } from "@/modules/sales/opportunity.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

/** Vérifie l'affaire au-dessus de `loading.tsx` : une affaire inconnue répond un vrai 404. */
export default async function OpportunityLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const ctx = await getServiceContext();
  if (can(ctx.actor, "sales:read")) {
    const { id } = await params;
    try {
      await getOpportunity(ctx, id);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
  }
  return children;
}
