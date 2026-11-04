import "server-only";
import { getEnv } from "@/server/config/env";
import { UptimeKumaClient, type UptimeKumaGateway } from "./uptime-kuma.client";

export type { MonitorReading, MonitorState, UptimeKumaGateway } from "./uptime-kuma.client";
export { UptimeKumaClient } from "./uptime-kuma.client";

/** Passerelle configurée par l'environnement. Sans URL ni page : `isConfigured` vaut `false`. */
export function getUptimeKumaGateway(): UptimeKumaGateway {
  const { UPTIME_KUMA_URL, UPTIME_KUMA_STATUS_SLUG } = getEnv();
  return new UptimeKumaClient(
    UPTIME_KUMA_URL && UPTIME_KUMA_STATUS_SLUG
      ? { baseUrl: UPTIME_KUMA_URL, statusSlug: UPTIME_KUMA_STATUS_SLUG }
      : null,
  );
}
