import { checkDatabase } from "@/server/health";

export const dynamic = "force-dynamic";

/** Healthcheck public : état minimal, aucune information interne exposée. */
export async function GET() {
  const databaseOk = await checkDatabase();
  return Response.json(
    { status: databaseOk ? "ok" : "unavailable" },
    { status: databaseOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
