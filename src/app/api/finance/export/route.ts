import { exportFinanceCsv } from "@/modules/finance/finance.export";
import { isInternalRole } from "@/server/auth/roles";
import { getCurrentActor, getServiceContext } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/** Export CSV des finances : session exigée, droits vérifiés par le service, jamais mis en cache. */
export async function GET(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  try {
    const actor = await getCurrentActor();
    if (!actor) {
      return Response.json({ error: "Connexion requise." }, { status: 401, headers: noStore });
    }
    if (!isInternalRole(actor.role)) {
      return Response.json({ error: "Accès refusé." }, { status: 403, headers: noStore });
    }

    const { searchParams } = new URL(request.url);
    const { filename, csv } = await exportFinanceCsv(
      await getServiceContext(),
      searchParams.get("jeu") ?? "",
      { importId: searchParams.get("import") ?? undefined },
    );
    return new Response(csv, {
      headers: {
        ...noStore,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return Response.json(
        { error: error.message },
        { status: error.httpStatus, headers: noStore },
      );
    }
    logger.error("finance.export_failed", { error });
    return Response.json(
      { error: "L'export n'a pas pu être généré." },
      { status: 500, headers: noStore },
    );
  }
}
