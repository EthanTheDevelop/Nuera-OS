import { getUptimeKumaGateway, type UptimeKumaGateway } from "@/integrations/uptime-kuma";
import type { MonitorNotification } from "@/integrations/uptime-kuma/uptime-kuma.webhook";
import { emitEvent } from "@/modules/platform/events";
import { openIncidentTicket } from "@/modules/support/ticket.service";
import type { Database } from "@/server/db/types";
import { AppError, ServiceUnavailableError } from "@/server/errors";
import { logger } from "@/server/logger";
import { parisDay } from "./site.health";
import * as repository from "./site.repository";

/**
 * Surveillance : lecture de la page de statut publiée d'Uptime Kuma.
 *
 * Échantillon du jour : `uptime24h` (fenêtre glissante de 24 h calculée par Kuma) et moyenne des
 * derniers battements. Une lecture plus récente le remplace, la dernière de la journée fait foi.
 *
 * Pannes : seul l'état `down` d'une sonde lue compte. Kuma injoignable ne dit rien des sites : aucun
 * site n'est déclaré hors ligne parce que la surveillance l'est. `pending` et `maintenance` ne
 * changent rien : Kuma a ses propres tentatives avant de conclure.
 */
const SERVICE = "uptime_kuma";
const SOURCE = "uptime_kuma";

export interface MonitorSyncResult {
  items: number;
  /** Sites dont la sonde n'est pas sur la page de statut. */
  missing: number;
  /** Bascules appliquées (`site.down`, `site.up`). */
  transitions: number;
  failures: number;
}

/**
 * Applique un état lu. Transaction unique : si le ticket échoue, l'événement n'est pas émis et la
 * lecture suivante réessaie. Rejouer le même état n'a aucun effet.
 *
 * Le verrou sur le site sérialise la lecture planifiée et le webhook : sans lui, deux lectures
 * simultanées annonceraient deux fois la même panne. Un état plus ancien que le dernier connu (lecture
 * partie avant une notification) ne l'écrase pas. Seul un site en ligne tombe en panne : une sonde
 * rouge sur un site prévu, en préproduction ou en pause est une mesure, pas un incident.
 */
async function applyMonitorState(
  db: Database,
  site: repository.MonitoredSite,
  state: "up" | "down",
  at: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await repository.findSiteByIdForUpdate(tx, site.id);
    if (!current || current.archivedAt) return false;
    const lastEvent = await repository.findLastMonitorEvent(tx, site.id);
    if (lastEvent && at.getTime() < lastEvent.occurredAt.getTime()) return false;
    const last = lastEvent?.type;
    const payload = { name: site.name, primaryDomain: site.primaryDomain, source: SOURCE };
    const stamp = at.toISOString();

    if (state === "down") {
      if (last === "site.down" || current.status !== "live") return false;
      await emitEvent(tx, {
        type: "site.down",
        entityType: "site",
        entityId: site.id,
        companyId: site.companyId,
        payload,
        actorId: null,
        dedupeKey: `site.down:${site.id}:${stamp}`,
        occurredAt: at,
      });
      await openIncidentTicket(tx, {
        siteId: site.id,
        title: `Site injoignable : ${site.primaryDomain ?? site.name}`,
        source: SOURCE,
      });
      return true;
    }

    // Un site jamais tombé n'a rien à annoncer : `site.up` ne suit qu'un `site.down`.
    if (last !== "site.down") return false;
    await emitEvent(tx, {
      type: "site.up",
      entityType: "site",
      entityId: site.id,
      companyId: site.companyId,
      payload,
      actorId: null,
      dedupeKey: `site.up:${site.id}:${stamp}`,
      occurredAt: at,
    });
    return true;
  });
}

/**
 * Lit les sondes et écrit les échantillons, les pannes et le rétablissement. Lève
 * `ServiceUnavailableError` si la connexion n'est pas configurée, sans trace d'échec.
 */
export async function runUptimeKumaSync(
  db: Database,
  deps: { uptimeKuma?: UptimeKumaGateway; now?: Date } = {},
): Promise<MonitorSyncResult> {
  const uptimeKuma = deps.uptimeKuma ?? getUptimeKumaGateway();
  const now = deps.now ?? new Date();

  if (!uptimeKuma.isConfigured) {
    await repository.recordIntegrationCheck(db, SERVICE, {
      status: "not_configured",
      checkedAt: now,
      error: null,
    });
    throw new ServiceUnavailableError(
      SERVICE,
      "not_configured",
      "Connexion requise : l'URL ou la page de statut d'Uptime Kuma n'est pas renseignée.",
    );
  }

  const run = await repository.startSyncRun(db, SERVICE, "status_page");
  let readings: Awaited<ReturnType<UptimeKumaGateway["readMonitors"]>>;
  try {
    readings = await uptimeKuma.readMonitors();
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur interne.";
    await repository.finishSyncRun(db, run.id, { status: "failed", items: 0, error: message });
    await repository.recordIntegrationCheck(db, SERVICE, {
      status:
        error instanceof ServiceUnavailableError && error.connectionRequired
          ? "not_configured"
          : "unavailable",
      checkedAt: now,
      error: message,
    });
    throw error;
  }

  const sites = await repository.listMonitoredSites(db);
  const day = parisDay(now);
  const failures: string[] = [];
  let items = 0;
  let missing = 0;
  let transitions = 0;

  for (const site of sites) {
    const reading = readings.get(site.monitorId);
    if (!reading) {
      missing += 1;
      continue;
    }
    try {
      await repository.upsertUptimeSample(db, {
        siteId: site.id,
        day,
        uptimeRatio: reading.uptime24h,
        avgResponseMs: reading.avgPingMs,
        checkedAt: reading.lastBeatAt ?? now,
      });
      items += 1;
      if (
        (reading.state === "down" || reading.state === "up") &&
        (await applyMonitorState(db, site, reading.state, reading.lastBeatAt ?? now))
      ) {
        transitions += 1;
      }
    } catch (error) {
      logger.warn("sites.monitor_apply_failed", {
        siteId: site.id,
        code: error instanceof AppError ? error.code : "INTERNAL",
      });
      failures.push(`${site.name} : ${error instanceof AppError ? error.message : "échec"}`);
    }
  }

  // Une sonde absente ne fait pas échouer le passage, mais ce site n'est plus mesuré : c'est dit.
  const notes =
    missing > 0
      ? [
          ...failures,
          `${missing} sonde${missing > 1 ? "s" : ""} absente${missing > 1 ? "s" : ""} de la page de statut`,
        ]
      : failures;
  const error = notes.length > 0 ? notes.slice(0, 10).join(" ; ").slice(0, 2000) : null;
  await repository.finishSyncRun(db, run.id, {
    status: failures.length > 0 ? "failed" : "succeeded",
    items,
    error,
  });
  await repository.recordIntegrationCheck(db, SERVICE, {
    status: notes.length > 0 ? "degraded" : "connected",
    checkedAt: now,
    error,
  });
  return { items, missing, transitions, failures: failures.length };
}

/**
 * Notification « Webhook » de Kuma, déjà authentifiée par l'appelant : l'accélérateur de la lecture
 * planifiée, qui reste la référence. Sonde inconnue ou état intermédiaire : ignoré.
 */
export async function handleUptimeKumaNotification(
  db: Database,
  notification: MonitorNotification,
  now: Date = new Date(),
): Promise<"applied" | "unchanged" | "ignored"> {
  if (notification.state !== "up" && notification.state !== "down") return "ignored";
  const site = await repository.findMonitoredSiteByMonitorId(db, notification.monitorId);
  if (!site) return "ignored";
  const applied = await applyMonitorState(db, site, notification.state, notification.at ?? now);
  return applied ? "applied" : "unchanged";
}
