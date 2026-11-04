import type { NextRequest } from "next/server";
import { contentDisposition } from "@/modules/documents/document.format";
import { openDocumentDownload } from "@/modules/documents/document.service";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { resolveRequestContext } from "@/modules/documents/document.request";
import { errorResponse } from "../../_http";

const PREVIEW_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function parseVersion(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1)
    throw new NotFoundError("Ce document n'existe pas.");
  return version;
}

/**
 * Téléchargement sécurisé, seule porte vers un fichier : session, puis `assertDocumentReadable`
 * (équipe, prestataire par projet, client du portail). Hors périmètre, 404 : on ne confirme pas
 * qu'un document existe. En pièce jointe, le navigateur ne l'interprète jamais. Seul l'aperçu d'un
 * PDF ou d'une image s'ouvre dans un onglet, sans `sandbox` qui bloquerait le lecteur PDF.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { ctx } = await resolveRequestContext();
    const { id } = await params;
    const file = await openDocumentDownload(ctx, id, {
      version: parseVersion(request.nextUrl.searchParams.get("version")),
      preview: request.nextUrl.searchParams.get("apercu") === "1",
    });
    return new Response(file.stream, {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": contentDisposition(
          file.filename,
          file.inline ? "inline" : "attachment",
        ),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": file.inline ? PREVIEW_CSP : "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const hidden = error instanceof ForbiddenError ? new NotFoundError() : error;
    return errorResponse(hidden, "documents.download");
  }
}

/** Sans cela, Next.js répond à HEAD en exécutant GET : un faux téléchargement au journal. */
export function HEAD(): Response {
  return new Response(null, { status: 405, headers: { Allow: "GET" } });
}
