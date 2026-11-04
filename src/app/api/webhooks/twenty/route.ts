import { NextResponse } from "next/server";
import { handleTwentyWebhookRequest } from "@/modules/crm/crm.webhook";

/**
 * Webhook Twenty : public, authentifié par sa seule signature HMAC sur le corps brut.
 * Il accélère la projection, la réconciliation la garantit (voir `crm.sync.service.ts`).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { status, body } = await handleTwentyWebhookRequest(await request.text(), request.headers);
  return NextResponse.json(body, { status });
}
