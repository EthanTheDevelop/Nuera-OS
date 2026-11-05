import { NextResponse, type NextRequest } from "next/server";
import { isValidWebhookToken } from "@/integrations/coolify/coolify.webhook";
import {
  parseUptimeKumaWebhook,
  UPTIME_KUMA_WEBHOOK_HEADER,
} from "@/integrations/uptime-kuma/uptime-kuma.webhook";
import { processUptimeKumaNotification } from "@/modules/platform/uptime.webhook";
import { getEnv } from "@/server/config/env";
import { readBodyWithin } from "@/server/http/limited-body";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Notifications d'Uptime Kuma : l'accélérateur de la lecture planifiée, qui reste la référence. Kuma
 * ne signe rien : le secret passe par un en-tête configuré dans la notification. Sans secret : 404.
 */
export async function POST(request: NextRequest) {
  const secret = getEnv().UPTIME_KUMA_WEBHOOK_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  if (!isValidWebhookToken(request.headers.get(UPTIME_KUMA_WEBHOOK_HEADER), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await readBodyWithin(request, MAX_BODY_BYTES);
  if (raw === null) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Message de test de Kuma, ou état sans intérêt : accusé sans effet.
  const notification = parseUptimeKumaWebhook(body);
  if (!notification) return NextResponse.json({ result: "ignored" });

  const result = await processUptimeKumaNotification(notification);
  return NextResponse.json({ result });
}
