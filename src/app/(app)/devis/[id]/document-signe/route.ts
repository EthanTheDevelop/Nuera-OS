import { NextResponse } from "next/server";
import { getDocusealGateway } from "@/integrations/docuseal";
import { getSignedDocumentUrl } from "@/modules/quotes/quote-signature.service";
import { getServiceContext } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Ouvre le document signé dans DocuSeal. Son adresse expire vite : on la relit à chaque clic, puis on
 * redirige. Droits dans le service. Devis hors de portée : 404. DocuSeal indisponible ou document
 * absent : retour au devis, qui le dit.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const ctx = await getServiceContext();
  try {
    const url = await getSignedDocumentUrl(ctx, id, { docuseal: getDocusealGateway() });
    return NextResponse.redirect(url);
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "FORBIDDEN") {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
    if (error.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Devis introuvable." }, { status: 404 });
    }
    logger.warn("quote.signed_document_unavailable", { quoteId: id, code: error.code });
    return NextResponse.redirect(new URL(`/devis/${id}?document=indisponible`, request.url));
  }
}
