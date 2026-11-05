import { unstable_rethrow } from "next/navigation";
import { startExport } from "@/modules/admin/export.service";
import { isInternalRole } from "@/server/auth/roles";
import { getCurrentActor, getServiceContext } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Export des données : session exigée, `export:run` vérifié par le service, jamais mis en cache. */
export async function GET(request: Request) {
  try {
    const actor = await getCurrentActor();
    if (!actor) {
      return Response.json({ error: "Connexion requise." }, { status: 401, headers: NO_STORE });
    }
    if (!isInternalRole(actor.role)) {
      return Response.json({ error: "Accès refusé." }, { status: 403, headers: NO_STORE });
    }
    const { searchParams } = new URL(request.url);
    const exported = await startExport(await getServiceContext(), {
      jeu: searchParams.get("jeu") ?? "tout",
      format: searchParams.get("format") ?? "json",
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await exported.chunks.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch (error) {
          logger.error("export.stream_failed", { error });
          controller.error(error);
        }
      },
      async cancel() {
        await exported.chunks.return(undefined);
      },
    });
    return new Response(body, {
      headers: {
        ...NO_STORE,
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    // Double authentification exigée et absente : `getServiceContext` redirige vers le profil.
    unstable_rethrow(error);
    if (isAppError(error)) {
      return Response.json(
        { error: error.message },
        { status: error.httpStatus, headers: NO_STORE },
      );
    }
    logger.error("export.failed", { error });
    return Response.json(
      { error: "L'export n'a pas pu être généré." },
      { status: 500, headers: NO_STORE },
    );
  }
}
