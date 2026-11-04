import { z } from "@/lib/zod";
import { mapMonitorStatus, parseKumaTime, type MonitorState } from "./uptime-kuma.client";

/**
 * Notification « Webhook » de Kuma (`server/notification-providers/webhook.js`) :
 * `{ heartbeat, monitor, msg }`. Kuma ne signe rien mais permet des en-têtes supplémentaires : le
 * secret passe par l'en-tête `x-nuera-webhook-token`. Le message de test n'a pas de battement.
 */
const payloadSchema = z.object({
  heartbeat: z
    .object({
      monitorID: z.number(),
      status: z.number(),
      time: z.string().nullish(),
      important: z.boolean().nullish(),
    })
    .nullish(),
});

export const UPTIME_KUMA_WEBHOOK_HEADER = "x-nuera-webhook-token";

export interface MonitorNotification {
  monitorId: string;
  state: MonitorState;
  at: Date | null;
}

/** `null` : ni battement ni état exploitable (message de test, corps inattendu). */
export function parseUptimeKumaWebhook(body: unknown): MonitorNotification | null {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success || !parsed.data.heartbeat) return null;
  const { monitorID, status, time } = parsed.data.heartbeat;
  const state = mapMonitorStatus(status);
  return state ? { monitorId: String(monitorID), state, at: parseKumaTime(time) } : null;
}
