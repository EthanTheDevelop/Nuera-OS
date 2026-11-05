import { contentDisposition } from "@/modules/documents/document.format";
import { buildAppointmentIcs } from "@/modules/portal/portal.format";
import { getPortalAppointment } from "@/modules/portal/portal.service";
import { getCurrentActor, getPortalContext } from "@/server/auth/session";
import { ForbiddenError, isAppError } from "@/server/errors";
import { logger } from "@/server/logger";

/** « Ajouter à mon agenda » : un fichier .ics, sans service tiers. Hors périmètre : 404. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    if (!(await getCurrentActor())) return new Response("Introuvable.", { status: 404 });
    const { id } = await params;
    const appointment = await getPortalAppointment(await getPortalContext(), id);
    return new Response(buildAppointmentIcs(appointment), {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": contentDisposition("rendez-vous-nuera.ics"),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || isAppError(error)) {
      return new Response("Introuvable.", { status: 404 });
    }
    logger.error("portal.agenda_failed", { error });
    return new Response("Une erreur inattendue est survenue.", { status: 500 });
  }
}
