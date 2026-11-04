import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getContact } from "@/modules/crm/contact.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

/** Vérifie la fiche au-dessus de `loading.tsx` : un contact inconnu répond un vrai 404. */
export default async function ContactLayout({
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
      await getContact(ctx, id);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
  }
  return children;
}
