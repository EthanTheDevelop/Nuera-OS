import { NextResponse } from "next/server";
import { handleDocusealWebhookRequest } from "@/modules/quotes/quote.webhook";
import { readBodyWithin, WEBHOOK_MAX_BODY_BYTES } from "@/server/http/limited-body";

/** Webhook DocuSeal : public, authentifié par sa seule signature HMAC (voir le service). */
export async function POST(request: Request): Promise<NextResponse> {
  const raw = await readBodyWithin(request, WEBHOOK_MAX_BODY_BYTES);
  if (raw === null) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const { status, body } = await handleDocusealWebhookRequest(raw, request.headers);
  return NextResponse.json(body, { status });
}
