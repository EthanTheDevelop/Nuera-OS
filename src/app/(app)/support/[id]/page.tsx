import { notFound, redirect } from "next/navigation";
import { ForbiddenState } from "@/components/states/states";
import { getTicketDetail } from "@/modules/support/ticket.service";
import { canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

/**
 * Lien stable vers une demande (notifications, fiche client) : la fiche s'ouvre en fenêtre au-dessus
 * du tableau. Hors périmètre : 404.
 */
export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["support:read", "support:read_assigned"])) return <ForbiddenState />;
  const { id } = await params;
  try {
    await getTicketDetail(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  redirect(`/support?demande=${id}`);
}
