import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { openNotification } from "@/modules/platform/notifications.service";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError, ValidationError } from "@/server/errors";

/**
 * Ouvre une notification : la marque lue, puis mène à son objet. Une préchargement de lien ne compte
 * pas comme une lecture. La notification d'un autre compte répond 404.
 */
export default async function OpenNotificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getServiceContext();
  const { id } = await params;
  const requestHeaders = await headers();
  if (requestHeaders.has("next-router-prefetch")) return null;

  let href: string | null;
  try {
    ({ href } = await openNotification(ctx, id));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  }
  redirect(href ?? "/profil/notifications");
}
