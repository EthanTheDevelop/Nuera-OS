import { NextResponse } from "next/server";
import { handleTwentyWebhookRequest } from "@/modules/crm/crm.webhook";
import { readBodyWithin, WEBHOOK_MAX_BODY_BYTES } from "@/server/http/limited-body";

/**
 * Webhook Twenty : public, authentifié par sa seule signature HMAC sur le corps brut.
 * Il accélère la projection, la réconciliation la garantit (voir `crm.sync.service.ts`).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const raw = await readBodyWithin(request, WEBHOOK_MAX_BODY_BYTES);
  if (raw === null) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const { status, body } = await handleTwentyWebhookRequest(raw, request.headers);
  return NextResponse.json(body, { status });
}
