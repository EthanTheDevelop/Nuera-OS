import { contentDisposition } from "@/modules/documents/document.format";
import { openPortalArchive } from "@/modules/portal/portal-archive";
import { getCurrentActor, getPortalContext } from "@/server/auth/session";
import { ForbiddenError, isAppError, UnauthenticatedError } from "@/server/errors";
import { logger } from "@/server/logger";

/** Archive des documents du client connecté. Aucun paramètre : l'adhésion dit tout. */
export async function GET(): Promise<Response> {
  try {
    if (!(await getCurrentActor())) throw new UnauthenticatedError();
    const archive = await openPortalArchive(await getPortalContext());
    return new Response(archive.stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(archive.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return new Response("Introuvable.", { status: 404 });
    }
    if (isAppError(error)) {
      logger.info("portal.archive_rejected", { code: error.code });
      return new Response(error.message, {
        status: error.httpStatus,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    logger.error("portal.archive_failed", { error });
    return new Response("Une erreur inattendue est survenue.", { status: 500 });
  }
}
