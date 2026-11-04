import type { QuoteDeps } from "@/modules/quotes/quote.deps";
import {
  createAmendment,
  createQuote,
  getQuoteEditor,
  saveQuoteContent,
} from "@/modules/quotes/quote.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { assertChangeRequestTransition } from "./change-request.status";
import { lockChangeRequest } from "./production.repository";
import { linkChangeRequestQuote, requireOpenChangeRequest } from "./production.service";
import { findProject } from "./project.repository";
import { convertChangeRequestSchema } from "./project.schema";

/**
 * Transforme une demande de changement en devis : un avenant si le projet vient d'un devis signé,
 * sinon un nouveau devis. Le chiffrage de la demande devient la première ligne. Tout tient dans une
 * transaction, sous le verrou de la demande : un échec ne laisse ni devis ni numéro consommé, et un
 * double envoi rouvre le même devis.
 */
export async function convertChangeRequestToQuote(
  ctx: ServiceContext,
  input: { changeRequestId: string },
  deps: QuoteDeps,
): Promise<{ quoteId: string }> {
  assertCan(ctx.actor, "quotes:create");
  assertCan(ctx.actor, "quotes:update");
  const parsed = parseInput(convertChangeRequestSchema, input);
  await requireOpenChangeRequest(ctx, parsed.changeRequestId);

  return ctx.db.transaction(async (tx) => {
    const scoped: ServiceContext = { ...ctx, db: tx };
    const changeRequest = await lockChangeRequest(tx, parsed.changeRequestId);
    if (!changeRequest) throw new NotFoundError("Demande de changement introuvable.");
    if (changeRequest.status === "converted" && changeRequest.quoteId) {
      return { quoteId: changeRequest.quoteId };
    }
    assertChangeRequestTransition(changeRequest.status, "converted");

    const project = changeRequest.projectId ? await findProject(tx, changeRequest.projectId) : null;
    const title = changeRequest.title;
    const quote = project?.quoteId
      ? await createAmendment(scoped, project.quoteId, { title })
      : await createQuote(scoped, { companyId: changeRequest.companyId, title });
    await linkChangeRequestQuote(scoped, {
      changeRequestId: changeRequest.id,
      quoteId: quote.id,
    });

    if (changeRequest.amountCents !== null || changeRequest.estimatedMinutes !== null) {
      const { version } = await getQuoteEditor(scoped, quote.id);
      await saveQuoteContent(
        scoped,
        quote.id,
        {
          title,
          scope: version.scope,
          exclusions: version.exclusions,
          conditions: version.conditions,
          taxPercent: version.taxPercent,
          changeNote: `Demande de changement : ${title}`.slice(0, 500),
          lines: [
            {
              label: title,
              quantity: 1,
              unitPriceCents: changeRequest.amountCents ?? 0,
              estimatedCostCents: 0,
              estimatedMinutes: changeRequest.estimatedMinutes ?? 0,
            },
          ],
        },
        deps,
      );
    }
    return { quoteId: quote.id };
  });
}
