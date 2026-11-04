import { eq } from "drizzle-orm";
import { createChangeRequest, linkChangeRequestQuote } from "@/modules/projects/production.service";
import { createQuote } from "@/modules/quotes/quote.service";
import type { ServiceContext } from "@/server/context";
import { changeRequests, quotes, type Ticket } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Passage d'une demande hors forfait vers une prestation, par les services des modules Projets et
 * Devis : la demande de changement garde le lien vers le ticket et vers le devis. L'appelant tient
 * la transaction et le verrou de la demande.
 */
export interface ChangeRequestLink {
  id: string;
  title: string;
  status: string;
  quoteId: string | null;
  quoteNumber: string | null;
}

export async function findChangeRequestLink(
  db: Database,
  changeRequestId: string | null,
): Promise<ChangeRequestLink | null> {
  if (!changeRequestId) return null;
  const [row] = await db
    .select({
      id: changeRequests.id,
      title: changeRequests.title,
      status: changeRequests.status,
      quoteId: changeRequests.quoteId,
      quoteNumber: quotes.number,
    })
    .from(changeRequests)
    .leftJoin(quotes, eq(quotes.id, changeRequests.quoteId))
    .where(eq(changeRequests.id, changeRequestId))
    .limit(1);
  return row ?? null;
}

export async function createLinkedChangeRequest(
  ctx: ServiceContext,
  ticket: Ticket,
): Promise<string> {
  // Rattachée au client plutôt qu'au projet : un projet livré n'accepte plus de changement, et le
  // ticket garde son propre lien vers le projet.
  const changeRequest = await createChangeRequest(ctx, {
    companyId: ticket.companyId,
    ticketId: ticket.id,
    title: ticket.subject,
    description: ticket.description,
  });
  return changeRequest.id;
}

/** Devis en brouillon pour la demande de changement, qui passe à « transformée ». */
export async function createLinkedQuote(
  ctx: ServiceContext,
  ticket: Ticket,
  changeRequestId: string,
): Promise<string> {
  const quote = await createQuote(ctx, {
    companyId: ticket.companyId,
    title: `${ticket.number} · ${ticket.subject}`.slice(0, 200),
  });
  await linkChangeRequestQuote(ctx, { changeRequestId, quoteId: quote.id });
  return quote.id;
}
