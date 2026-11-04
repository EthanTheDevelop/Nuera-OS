import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireReadableProject } from "@/modules/projects/project.access";
import { canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError, ValidationError } from "@/server/errors";

/**
 * Vérifie l'accès au projet au-dessus de `loading.tsx` : une fois le squelette envoyé, la réponse
 * resterait en 200. Un projet inconnu ou hors périmètre répond donc un vrai 404. La page refait le
 * contrôle à travers le service, c'est elle qui fait autorité.
 */
export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const ctx = await getServiceContext();
  if (canAny(ctx.actor, ["projects:read", "projects:read_assigned"])) {
    const { id } = await params;
    try {
      await requireReadableProject(ctx, id);
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
      throw error;
    }
  }
  return children;
}
