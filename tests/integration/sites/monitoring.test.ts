import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UptimeKumaClient } from "@/integrations/uptime-kuma";
import { mapMonitorStatus, parseKumaTime } from "@/integrations/uptime-kuma/uptime-kuma.client";
import { parseUptimeKumaWebhook } from "@/integrations/uptime-kuma/uptime-kuma.webhook";
import {
  handleUptimeKumaNotification,
  runUptimeKumaSync,
} from "@/modules/sites/monitoring.service";
import { parisDay } from "@/modules/sites/site.health";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";
import { createSite } from "../../helpers/factories";
import { startHttpStub, type HttpStub } from "./http-stub";

let db: Database;
let close: () => Promise<void>;
let stub: HttpStub;
let uptimeKuma: UptimeKumaClient;

const SLUG = "nuera";
const ROUTE = `GET /api/status-page/heartbeat/${SLUG}`;
const NOW = new Date("2026-11-04T12:00:00Z");
let monitorCounter = 100;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  stub = await startHttpStub();
  uptimeKuma = new UptimeKumaClient({ baseUrl: stub.url, statusSlug: SLUG, timeoutMs: 2000 });
});

afterEach(() => {
  stub.routes.clear();
  stub.requests.length = 0;
});

afterAll(async () => {
  await stub.close();
  await close();
});

async function monitoredSite() {
  monitorCounter += 1;
  const monitorId = String(monitorCounter);
  const site = await createSite(db, { monitorId, status: "live" });
  return { site, monitorId };
}

/** Réponse de Kuma pour une sonde : dernier battement `status`, disponibilité sur 24 h. */
function serve(monitorId: string, status: number, uptime: number | null = 0.9998, ping = 200) {
  stub.routes.set(ROUTE, () => ({
    heartbeatList: {
      [monitorId]: [
        { status: 1, time: "2026-11-04 11:58:00.000", msg: "", ping: ping - 100 },
        { status, time: "2026-11-04 11:59:00.000", msg: "", ping: ping + 100 },
      ],
    },
    uptimeList: uptime === null ? {} : { [`${monitorId}_24`]: uptime },
  }));
}

async function events(siteId: string, type: string) {
  return db
    .select()
    .from(schema.domainEvents)
    .where(and(eq(schema.domainEvents.entityId, siteId), eq(schema.domainEvents.type, type)));
}

async function incidents(siteId: string) {
  return db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.siteId, siteId), eq(schema.tickets.isIncident, true)));
}

describe("échantillons quotidiens", () => {
  it("stocke la disponibilité 24 h et la moyenne des battements du jour", async () => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, 1);
    await expect(runUptimeKumaSync(db, { uptimeKuma, now: NOW })).resolves.toMatchObject({
      items: 1,
      transitions: 0,
      failures: 0,
    });

    const [sample] = await db
      .select()
      .from(schema.siteUptimeSamples)
      .where(eq(schema.siteUptimeSamples.siteId, site.id));
    expect(sample).toMatchObject({
      day: parisDay(NOW),
      uptimeRatio: 0.9998,
      avgResponseMs: 200,
      // Kuma n'expose pas cette mesure : elle reste vide, jamais à zéro.
      serverErrors: null,
    });
    expect(sample?.checkedAt).toEqual(new Date("2026-11-04T11:59:00.000Z"));
  });

  it("une nouvelle lecture du même jour remplace, sans doublon", async () => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, 1, 0.9);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    serve(monitorId, 1, 0.95);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    const rows = await db
      .select()
      .from(schema.siteUptimeSamples)
      .where(eq(schema.siteUptimeSamples.siteId, site.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uptimeRatio).toBe(0.95);
  });

  it("sonde absente de la page de statut : comptée, sans mesure inventée", async () => {
    const { site } = await monitoredSite();
    serve("sonde-d-un-autre-site", 1);
    const result = await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    expect(result.missing).toBeGreaterThan(0);
    const rows = await db
      .select()
      .from(schema.siteUptimeSamples)
      .where(eq(schema.siteUptimeSamples.siteId, site.id));
    expect(rows).toHaveLength(0);
    const [connection] = await db
      .select()
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.service, "uptime_kuma"));
    expect(connection?.status).toBe("degraded");
    expect(connection?.lastError).toContain("absente");
  });

  it("page inconnue ou sans groupe public (200, listes vides) : connexion requise, jamais un succès", async () => {
    const { site } = await monitoredSite();
    stub.routes.set(ROUTE, () => ({ heartbeatList: {}, uptimeList: {} }));
    await expect(runUptimeKumaSync(db, { uptimeKuma, now: NOW })).rejects.toMatchObject({
      reason: "not_configured",
      connectionRequired: true,
    });
    const rows = await db
      .select()
      .from(schema.siteUptimeSamples)
      .where(eq(schema.siteUptimeSamples.siteId, site.id));
    expect(rows).toHaveLength(0);
    expect(await incidents(site.id)).toHaveLength(0);
  });

  it("sans disponibilité 24 h, l'échantillon la laisse vide", async () => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, 1, null);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    const [sample] = await db
      .select()
      .from(schema.siteUptimeSamples)
      .where(eq(schema.siteUptimeSamples.siteId, site.id));
    expect(sample?.uptimeRatio).toBeNull();
  });

  it("trace chaque passage", async () => {
    const { monitorId } = await monitoredSite();
    serve(monitorId, 1);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    const runs = await db
      .select()
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.service, "uptime_kuma"));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((run) => run.finishedAt !== null)).toBe(true);
  });
});

describe("pannes et rétablissement", () => {
  it("site down : événement et ticket d'incident, une seule fois", async () => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, 0);
    await expect(runUptimeKumaSync(db, { uptimeKuma, now: NOW })).resolves.toMatchObject({
      transitions: 1,
    });
    await expect(runUptimeKumaSync(db, { uptimeKuma, now: NOW })).resolves.toMatchObject({
      transitions: 0,
    });

    expect(await events(site.id, "site.down")).toHaveLength(1);
    const tickets = await incidents(site.id);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ channel: "monitoring", category: "incident" });
  });

  it("site up après une panne : événement, sans rouvrir de ticket", async () => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, 0);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    serve(monitorId, 1);
    await expect(runUptimeKumaSync(db, { uptimeKuma, now: NOW })).resolves.toMatchObject({
      transitions: 1,
    });
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });

    expect(await events(site.id, "site.up")).toHaveLength(1);
    expect(await incidents(site.id)).toHaveLength(1);
  });

  it("nouvelle panne pendant que le ticket est ouvert : pas de second ticket", async () => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, 0);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    serve(monitorId, 1);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    stub.routes.set(ROUTE, () => ({
      heartbeatList: { [monitorId]: [{ status: 0, time: "2026-11-04 13:00:00.000", ping: null }] },
      uptimeList: { [`${monitorId}_24`]: 0.9 },
    }));
    await runUptimeKumaSync(db, { uptimeKuma, now: new Date("2026-11-04T13:01:00Z") });

    expect(await events(site.id, "site.down")).toHaveLength(2);
    expect(await incidents(site.id)).toHaveLength(1);
  });

  it("un site jamais tombé n'annonce pas de rétablissement", async () => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, 1);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    expect(await events(site.id, "site.up")).toHaveLength(0);
  });

  it.each([
    ["en attente", 2],
    ["en maintenance", 3],
  ])("une sonde %s ne déclenche rien", async (_, status) => {
    const { site, monitorId } = await monitoredSite();
    serve(monitorId, status);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    expect(await events(site.id, "site.down")).toHaveLength(0);
    expect(await incidents(site.id)).toHaveLength(0);
  });

  it("un site archivé n'est plus surveillé", async () => {
    const { site, monitorId } = await monitoredSite();
    await db
      .update(schema.sites)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(schema.sites.id, site.id));
    serve(monitorId, 0);
    await runUptimeKumaSync(db, { uptimeKuma, now: NOW });
    expect(await events(site.id, "site.down")).toHaveLength(0);
  });
});

describe("échec du service externe", () => {
  it("Kuma injoignable : aucun site déclaré en panne, trace d'échec", async () => {
    const { site } = await monitoredSite();
    stub.routes.set(ROUTE, () => ({ status: 503 }));
    await expect(runUptimeKumaSync(db, { uptimeKuma, now: NOW })).rejects.toMatchObject({
      reason: "unreachable",
    });
    expect(await events(site.id, "site.down")).toHaveLength(0);
    const [connection] = await db
      .select()
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.service, "uptime_kuma"));
    expect(connection?.status).toBe("unavailable");
  });

  it("serveur arrêté : même résultat", async () => {
    const down = new UptimeKumaClient({
      baseUrl: "http://127.0.0.1:1",
      statusSlug: SLUG,
      timeoutMs: 500,
    });
    await expect(down.readMonitors()).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("page de statut absente ou non publiée (404) : connexion requise", async () => {
    await expect(runUptimeKumaSync(db, { uptimeKuma, now: NOW })).rejects.toMatchObject({
      reason: "not_configured",
      connectionRequired: true,
    });
  });

  it("corps illisible : échec, pas de mesure", async () => {
    stub.routes.set(ROUTE, () => ({ body: { nimporte: "quoi" } }));
    await expect(uptimeKuma.readMonitors()).rejects.toThrow("illisible");
  });

  it("non configuré : connexion requise, pas d'appel", async () => {
    await expect(
      runUptimeKumaSync(db, { uptimeKuma: new UptimeKumaClient(null), now: NOW }),
    ).rejects.toMatchObject({ reason: "not_configured" });
    expect(stub.requests).toHaveLength(0);
  });
});

describe("notification webhook", () => {
  it("lit le corps réel de Kuma, et ignore le message de test", () => {
    expect(
      parseUptimeKumaWebhook({
        heartbeat: { monitorID: 12, status: 0, time: "2026-11-04 11:59:00.000", msg: "timeout" },
        monitor: { id: 12, name: "Site" },
        msg: "[Site] [DOWN] timeout",
      }),
    ).toEqual({
      monitorId: "12",
      state: "down",
      at: new Date("2026-11-04T11:59:00.000Z"),
    });
    expect(parseUptimeKumaWebhook({ heartbeat: null, monitor: null, msg: "test" })).toBeNull();
    expect(parseUptimeKumaWebhook("texte")).toBeNull();
  });

  it("applique une panne, et rejouer ne change rien", async () => {
    const { site, monitorId } = await monitoredSite();
    const notification = { monitorId, state: "down" as const, at: NOW };
    await expect(handleUptimeKumaNotification(db, notification)).resolves.toBe("applied");
    await expect(handleUptimeKumaNotification(db, notification)).resolves.toBe("unchanged");
    expect(await events(site.id, "site.down")).toHaveLength(1);
    expect(await incidents(site.id)).toHaveLength(1);
  });

  it("sonde inconnue ou état intermédiaire : ignoré", async () => {
    await expect(
      handleUptimeKumaNotification(db, { monitorId: "99999", state: "down", at: NOW }),
    ).resolves.toBe("ignored");
    const { monitorId } = await monitoredSite();
    await expect(
      handleUptimeKumaNotification(db, { monitorId, state: "pending", at: NOW }),
    ).resolves.toBe("ignored");
  });
});

describe("traductions Uptime Kuma", () => {
  it("états et dates", () => {
    expect(mapMonitorStatus(0)).toBe("down");
    expect(mapMonitorStatus(1)).toBe("up");
    expect(mapMonitorStatus(2)).toBe("pending");
    expect(mapMonitorStatus(3)).toBe("maintenance");
    expect(mapMonitorStatus(9)).toBeNull();
    expect(parseKumaTime("2026-11-04 08:12:03.123")).toEqual(new Date("2026-11-04T08:12:03.123Z"));
    expect(parseKumaTime("2026-11-04T08:12:03+01:00")).toEqual(
      new Date("2026-11-04T07:12:03.000Z"),
    );
    expect(parseKumaTime("pas une date")).toBeNull();
  });

  it("lien vers la sonde seulement si tout est connu", () => {
    expect(uptimeKuma.monitorUrl("12")).toBe(`${stub.url}/dashboard/12`);
    expect(uptimeKuma.monitorUrl(null)).toBeNull();
    expect(new UptimeKumaClient(null).monitorUrl("12")).toBeNull();
  });
});
