import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isJobName, runApplicationJob } from "@/modules/platform/jobs.service";
import { getEnv } from "@/server/config/env";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Comparaison à temps constant, sur des empreintes de même longueur. */
function bearerMatches(header: string | null, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

/**
 * Tâches planifiées (`docs/ops/jobs.md`). Sans `JOBS_SECRET` : 404, jamais ouvert. Une tâche qui
 * tourne déjà n'est pas relancée : la réponse est `skipped`, en 200, pour ne pas alerter le planificateur.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ job: string }> }) {
  const secret = getEnv().JOBS_SECRET;
  if (!secret) return new NextResponse(null, { status: 404, headers: NO_STORE });
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { job } = await context.params;
  if (!isJobName(job)) return new NextResponse(null, { status: 404, headers: NO_STORE });

  const outcome = await runApplicationJob(job);
  return NextResponse.json(
    { job, ...outcome },
    { status: outcome.status === "failed" ? 502 : 200, headers: NO_STORE },
  );
}
