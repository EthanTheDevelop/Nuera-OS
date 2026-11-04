import type { NextRequest } from "next/server";
import {
  getDocumentStorageStatus,
  toUploadedDocument,
  uploadDocumentVersion,
} from "@/modules/documents/document.service";
import { resolveRequestContext } from "@/modules/documents/document.request";
import { NotFoundError } from "@/server/errors";
import {
  assertDeclaredSize,
  assertSameOrigin,
  errorResponse,
  queryToObject,
  requestBody,
} from "../../_http";

/** Nouvelle version d'un document, réservée à l'équipe. Le corps de la requête est le fichier. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const context = await resolveRequestContext();
    if (context.kind !== "staff") throw new NotFoundError("Ce document n'existe pas.");
    assertDeclaredSize(request, getDocumentStorageStatus().maxBytes);
    const { id } = await params;
    const fields = queryToObject(request.nextUrl.searchParams);
    const result = await uploadDocumentVersion(
      context.ctx,
      { ...fields, documentId: id } as never,
      requestBody(request),
    );
    return Response.json(
      { document: toUploadedDocument(result) },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return errorResponse(error, "documents.upload_version");
  }
}
