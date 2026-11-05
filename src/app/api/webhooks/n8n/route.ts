import { NextResponse, type NextRequest } from "next/server";
import {
  checkN8nSignature,
  N8N_SIGNATURE_HEADER,
  N8N_TIMESTAMP_HEADER,
} from "@/integrations/n8n/n8n.client";
import { processN8nWebhook } from "@/modules/platform/n8n.webhook";
import { getEnv } from "@/server/config/env";

const MAX_BODY_BYTES = 64 * 1024;

/** Retour d'un scénario n8n, signé (`src/integrations/n8n/n8n.client.ts`). Sans secret : 404. */
export async function POST(request: NextRequest) {
  const secret = getEnv().N8N_WEBHOOK_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const signed = checkN8nSignature({
    secret,
    body: raw,
    signature: request.headers.get(N8N_SIGNATURE_HEADER),
    timestamp: request.headers.get(N8N_TIMESTAMP_HEADER),
  });
  if (!signed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const result = await processN8nWebhook(body);
  if (result === "invalid") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  return NextResponse.json({ result });
}
