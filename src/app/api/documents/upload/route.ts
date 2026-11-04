import type { NextRequest } from "next/server";
import {
  getDocumentStorageStatus,
  toUploadedDocument,
  uploadClientFile,
  uploadDocument,
} from "@/modules/documents/document.service";
import { resolveRequestContext } from "@/modules/documents/document.request";
import {
  assertDeclaredSize,
  assertSameOrigin,
  errorResponse,
  queryToObject,
  requestBody,
} from "../_http";

/**
 * Dépôt d'un fichier : le corps de la requête est le fichier lui-même, lu au fil de l'eau et jamais
 * chargé en mémoire. Les champs viennent de l'URL. L'équipe crée un document ; un client du portail
 * dépose un fichier, avec le client et la visibilité imposés par son adhésion.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertSameOrigin(request);
    const context = await resolveRequestContext();
    assertDeclaredSize(request, getDocumentStorageStatus().maxBytes);
    const fields = queryToObject(request.nextUrl.searchParams);
    const result =
      context.kind === "portal"
        ? await uploadClientFile(context.ctx, fields as never, requestBody(request))
        : await uploadDocument(context.ctx, fields as never, requestBody(request));
    return Response.json(
      { document: toUploadedDocument(result) },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return errorResponse(error, "documents.upload");
  }
}
