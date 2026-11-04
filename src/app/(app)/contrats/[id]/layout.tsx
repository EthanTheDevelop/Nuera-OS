import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { assertContractReadable } from "@/modules/contracts/contract.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

/**
 * Vérifie l'existence du contrat au-dessus de `loading.tsx` : une fois le squelette envoyé, la réponse
 * resterait en 200. La page refait le contrôle à travers le service, c'est elle qui fait autorité.
 */
export default async function ContractLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const ctx = await getServiceContext();
  if (can(ctx.actor, "contracts:read")) {
    const { id } = await params;
    try {
      await assertContractReadable(ctx, id);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
  }
  return children;
}
