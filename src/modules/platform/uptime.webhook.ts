import type { MonitorNotification } from "@/integrations/uptime-kuma/uptime-kuma.webhook";
import { handleUptimeKumaNotification } from "@/modules/sites/monitoring.service";
import { getDb } from "@/server/db/client";

/** Pour la route HTTP, qui n'importe pas la base. */
export function processUptimeKumaNotification(notification: MonitorNotification) {
  return handleUptimeKumaNotification(getDb(), notification);
}
