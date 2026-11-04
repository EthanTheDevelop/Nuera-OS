import "server-only";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { CAL_SIGNATURE_HEADER, processCalWebhook } from "./cal-webhook";

/** Adaptateur HTTP : la route reste sans accès direct à la base. */
export async function handleCalWebhook(request: Request): Promise<Response> {
  const secret = getEnv().CAL_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "not_found" }, { status: 404 });
  const result = await processCalWebhook(
    getDb(),
    secret,
    await request.text(),
    request.headers.get(CAL_SIGNATURE_HEADER),
  );
  return Response.json(result.body, { status: result.status });
}
