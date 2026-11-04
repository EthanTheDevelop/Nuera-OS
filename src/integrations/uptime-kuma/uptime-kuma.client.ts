import "server-only";
import { z } from "@/lib/zod";
import { IntegrationError, ServiceUnavailableError } from "@/server/errors";

/**
 * Adaptateur d'Uptime Kuma. Kuma n'a pas d'API REST de gestion ; sa documentation prévient que ses
 * routes internes peuvent changer sans préavis. On n'utilise donc que ce qui est public et lu dans
 * les sources (`server/routers/status-page-router.js`) :
 *
 * `GET /api/status-page/heartbeat/:slug` : pour les sondes des groupes publics d'une page publiée,
 * jusqu'à 100 battements par sonde (`heartbeatList`) et la disponibilité sur 24 h (`uptimeList`,
 * clé `<id>_24`). La route ne vérifie pas la page : un identifiant inconnu ou une page sans groupe
 * public répond 200 avec des listes vides. Une liste vide n'est donc jamais un succès.
 *
 * Aucune route publique ne donne les erreurs serveur : cette mesure reste « indisponible ».
 */
const SERVICE = "uptime_kuma";
const NOT_CONFIGURED =
  "Connexion requise : l'URL ou la page de statut d'Uptime Kuma n'est pas renseignée.";

export interface UptimeKumaConfig {
  baseUrl: string;
  statusSlug: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const responseSchema = z.object({
  heartbeatList: z.record(
    z.string(),
    z.array(
      z.object({
        status: z.number(),
        time: z.string(),
        ping: z.number().nullish(),
      }),
    ),
  ),
  uptimeList: z.record(z.string(), z.number().nullable()),
});

export type MonitorState = "up" | "down" | "pending" | "maintenance";

/** Valeurs de `heartbeat.status` dans `server/model/heartbeat.js`. */
const MONITOR_STATES: Record<number, MonitorState> = {
  0: "down",
  1: "up",
  2: "pending",
  3: "maintenance",
};

export function mapMonitorStatus(status: number): MonitorState | null {
  return MONITOR_STATES[status] ?? null;
}

/** Kuma écrit ses dates en UTC, sans fuseau : `2026-11-04 08:12:03.123`. */
export function parseKumaTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const date = new Date(hasZone ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface MonitorReading {
  monitorId: string;
  state: MonitorState | null;
  lastBeatAt: Date | null;
  /** Entre 0 et 1, fenêtre glissante de 24 h calculée par Kuma. `null` si Kuma n'en donne pas. */
  uptime24h: number | null;
  /** Moyenne des battements lus (au plus 100), en millisecondes. */
  avgPingMs: number | null;
}

/** Port utilisé par les services. */
export interface UptimeKumaGateway {
  readonly isConfigured: boolean;
  /** Lien vers la sonde dans la console (`/dashboard/:id`). */
  monitorUrl(monitorId: string | null | undefined): string | null;
  /** Une entrée par sonde publique, indexée par identifiant. */
  readMonitors(): Promise<Map<string, MonitorReading>>;
}

export class UptimeKumaClient implements UptimeKumaGateway {
  readonly isConfigured: boolean;
  private readonly baseUrl: string;
  private readonly statusSlug: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: UptimeKumaConfig | null) {
    this.isConfigured = config !== null;
    this.baseUrl = config?.baseUrl.replace(/\/+$/, "") ?? "";
    this.statusSlug = config?.statusSlug ?? "";
    this.timeoutMs = config?.timeoutMs ?? 10_000;
    this.fetchImpl = config?.fetch ?? fetch;
  }

  monitorUrl(monitorId: string | null | undefined): string | null {
    if (!this.isConfigured || !monitorId) return null;
    return `${this.baseUrl}/dashboard/${encodeURIComponent(monitorId)}`;
  }

  async readMonitors(): Promise<Map<string, MonitorReading>> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableError(SERVICE, "not_configured", NOT_CONFIGURED);
    }

    const url = `${this.baseUrl}/api/status-page/heartbeat/${encodeURIComponent(this.statusSlug)}`;
    let response: Response;
    let raw: string;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      raw = await response.text();
    } catch (cause) {
      throw new ServiceUnavailableError(SERVICE, "unreachable", "Uptime Kuma ne répond pas.", {
        cause,
      });
    }

    if (response.status === 404) {
      throw new ServiceUnavailableError(
        SERVICE,
        "not_configured",
        "Connexion requise : cette page de statut d'Uptime Kuma n'existe pas ou n'est pas publiée.",
        { status: 404 },
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableError(SERVICE, "unreachable", "Uptime Kuma ne répond pas.", {
        status: response.status,
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (cause) {
      throw new IntegrationError(SERVICE, "Réponse illisible d'Uptime Kuma.", { cause });
    }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new IntegrationError(SERVICE, "Réponse illisible d'Uptime Kuma.");
    if (Object.keys(parsed.data.heartbeatList).length === 0) {
      throw new ServiceUnavailableError(
        SERVICE,
        "not_configured",
        "Connexion requise : cette page de statut d'Uptime Kuma ne publie aucune sonde.",
      );
    }

    const readings = new Map<string, MonitorReading>();
    for (const [monitorId, beats] of Object.entries(parsed.data.heartbeatList)) {
      const last = beats[beats.length - 1];
      const pings = beats
        .map((beat) => beat.ping)
        .filter((ping): ping is number => typeof ping === "number");
      const uptime = parsed.data.uptimeList[`${monitorId}_24`];
      readings.set(monitorId, {
        monitorId,
        state: last ? mapMonitorStatus(last.status) : null,
        lastBeatAt: parseKumaTime(last?.time),
        uptime24h: typeof uptime === "number" ? Math.max(0, Math.min(1, uptime)) : null,
        avgPingMs:
          pings.length > 0
            ? Math.round(pings.reduce((total, ping) => total + ping, 0) / pings.length)
            : null,
      });
    }
    return readings;
  }
}
