import "server-only";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { readBodyWithin, WEBHOOK_MAX_BODY_BYTES } from "@/server/http/limited-body";
import { CAL_SIGNATURE_HEADER, processCalWebhook } from "./cal-webhook";

/** Adaptateur HTTP : la route reste sans accès direct à la base. */
export async function handleCalWebhook(request: Request): Promise<Response> {
  const secret = getEnv().CAL_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "not_found" }, { status: 404 });
  const raw = await readBodyWithin(request, WEBHOOK_MAX_BODY_BYTES);
  if (raw === null) return Response.json({ error: "too_large" }, { status: 413 });
  const result = await processCalWebhook(
    getDb(),
    secret,
    raw,
    request.headers.get(CAL_SIGNATURE_HEADER),
  );
  return Response.json(result.body, { status: result.status });
}
