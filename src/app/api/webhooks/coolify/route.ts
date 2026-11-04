import { NextResponse, type NextRequest } from "next/server";
import { isValidWebhookToken, parseCoolifyWebhook } from "@/integrations/coolify/coolify.webhook";
import { processCoolifyWebhook } from "@/modules/sites/coolify-sync.service";
import { getEnv } from "@/server/config/env";

/**
 * Notifications de Coolify. Elles ne sont pas signées : le secret est dans l'URL configurée dans le
 * canal webhook (`/api/webhooks/coolify?token=…`). Le corps n'est qu'un signal : le service relit
 * toujours l'état par l'API, et la synchronisation planifiée reste la référence.
 */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const { COOLIFY_WEBHOOK_SECRET } = getEnv();
  if (!COOLIFY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isValidWebhookToken(request.nextUrl.searchParams.get("token"), COOLIFY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const event = parseCoolifyWebhook(body);
  if (!event) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const result = await processCoolifyWebhook(event);
  return NextResponse.json({ result }, { status: result === "failed" ? 502 : 200 });
}
