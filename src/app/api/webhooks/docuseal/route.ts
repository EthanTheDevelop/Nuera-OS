import { NextResponse } from "next/server";
import { handleDocusealWebhookRequest } from "@/modules/quotes/quote.webhook";

/** Webhook DocuSeal : public, authentifié par sa seule signature HMAC (voir le service). */
export async function POST(request: Request): Promise<NextResponse> {
  const { status, body } = await handleDocusealWebhookRequest(
    await request.text(),
    request.headers,
  );
  return NextResponse.json(body, { status });
}
