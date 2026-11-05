import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { NextRequest } from "next/server";
import { getEnv } from "@/server/config/env";
import {
  ForbiddenError,
  isAppError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Dépôt : refuse une requête d'une autre origine. Les cookies de session sont déjà `SameSite=Lax` ;
 * ce contrôle ne laisse passer que l'interface de l'application.
 */
export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const allowed = new Set([request.nextUrl.origin, new URL(getEnv().BETTER_AUTH_URL).origin]);
  if (!origin || !allowed.has(origin)) throw new ForbiddenError("Origine de la requête refusée.");
}

export function assertDeclaredSize(request: NextRequest, maxBytes: number): void {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    const message = `Ce fichier dépasse la taille maximale de ${Math.round(maxBytes / (1024 * 1024))} Mo.`;
    throw new ValidationError(message, { file: [message] });
  }
}

/** Corps de la requête, jamais chargé en mémoire : le service le lit au fil de l'eau. */
export function requestBody(request: NextRequest): ReadableStream<Uint8Array> {
  if (!request.body) {
    const message = "Aucun fichier reçu.";
    throw new ValidationError(message, { file: [message] });
  }
  return request.body;
}

export function queryToObject(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params.entries());
}

/** Traduit une erreur en réponse JSON : message prévu pour l'utilisateur, jamais de détail interne. */
export function errorResponse(error: unknown, action: string): Response {
  // Compte de l'équipe à enrôler en double authentification : la redirection doit passer.
  unstable_rethrow(error);
  if (isAppError(error)) {
    logger.info("documents.request_rejected", { action, code: error.code });
    const unavailable = error instanceof ServiceUnavailableError;
    return Response.json(
      {
        error: {
          message: error.message,
          fieldErrors: error instanceof ValidationError ? error.fieldErrors : undefined,
          connectionRequired: unavailable ? error.connectionRequired : undefined,
        },
      },
      { status: unavailable ? 503 : error.httpStatus },
    );
  }
  logger.error("documents.request_failed", { action, error });
  return Response.json(
    { error: { message: "Une erreur inattendue est survenue. Réessayez plus tard." } },
    { status: 500 },
  );
}
