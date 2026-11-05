import { checkDatabase } from "@/server/health";

export const dynamic = "force-dynamic";

/**
 * Disponibilité, pour la supervision externe : même contrôle que `/api/health`, que Coolify et le
 * HEALTHCHECK de l'image utilisent (`docs/deployment-coolify.md`). État minimal, détail dans les journaux.
 */
export async function GET() {
  const databaseOk = await checkDatabase();
  return Response.json(
    { status: databaseOk ? "ok" : "unavailable" },
    { status: databaseOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
