import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCompany } from "@/modules/crm/company.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

/**
 * Vérifie la fiche au-dessus de `loading.tsx` : une fois le squelette envoyé, la réponse resterait
 * en 200. Inconnue : vrai 404. Absorbée par une fusion : redirection vers la gagnante. La page refait
 * la lecture à travers le service.
 */
export default async function ClientRecordLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const ctx = await getServiceContext();
  if (can(ctx.actor, "crm:read")) {
    const { id } = await params;
    try {
      const { company } = await getCompany(ctx, id);
      if (company.mergedIntoId) redirect(`/clients/${company.mergedIntoId}`);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
  }
  return children;
}
