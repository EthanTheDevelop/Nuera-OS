import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CoolifyClient } from "@/integrations/coolify";
import { isValidWebhookToken, parseCoolifyWebhook } from "@/integrations/coolify/coolify.webhook";
import { handleCoolifyWebhook, runCoolifySync } from "@/modules/sites/coolify-sync.service";
import {
  getSitesIntegrationState,
  getConsoleLinks,
  syncSitesNow,
} from "@/modules/sites/sync.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, ServiceUnavailableError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { UptimeKumaClient } from "@/integrations/uptime-kuma/uptime-kuma.client";
import { createSite } from "../../helpers/factories";
import { startHttpStub, type HttpStub } from "./http-stub";

/** Sans lui, le service lirait l'environnement, absent en test. */
const uptimeKuma = new UptimeKumaClient(null);

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let viewer: ServiceContext;
let stub: HttpStub;
let coolify: CoolifyClient;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  [admin, viewer] = await Promise.all([
    createTestContext(db, "admin"),
    createTestContext(db, "viewer"),
  ]);
  stub = await startHttpStub();
  coolify = new CoolifyClient({
    baseUrl: stub.url,
    token: "jeton-de-test",
    baseDelayMs: 1,
    timeoutMs: 2000,
  });
});

afterEach(async () => {
  stub.routes.clear();
  stub.requests.length = 0;
  // Chaque test a ses applications : les précédentes ne doivent plus être relues.
  await db.update(schema.siteEnvironments).set({ coolifyAppUuid: null });
});

afterAll(async () => {
  await stub.close();
  await close();
});

async function linkedEnvironment(app: string, kind: "production" | "staging" = "production") {
  const site = await createSite(db);
  const [environment] = await db
    .insert(schema.siteEnvironments)
    .values({ siteId: site.id, kind, coolifyAppUuid: app })
    .returning();
  if (!environment) throw new Error("Environnement non créé");
  return { site, environment };
}

function serveApplications(applications: unknown[]) {
  stub.routes.set("GET /api/v1/applications", () => applications);
  stub.routes.set("GET /api/v1/resources", () => []);
}

async function lastRun(service: "coolify") {
  const rows = await db.select().from(schema.syncRuns).where(eq(schema.syncRuns.service, service));
  return rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
}

describe("synchronisation des statuts et déploiements", () => {
  it("écrit statut daté, déploiements et trace, en lisant la vraie forme de l'API", async () => {
    const { environment } = await linkedEnvironment("app-a");
    const now = new Date("2026-11-04T12:00:00Z");
    serveApplications([{ uuid: "app-a", status: "running:healthy", environment_id: 7 }]);
    // Forme réelle du contrôleur Coolify, différente de sa spécification OpenAPI.
    stub.routes.set("GET /api/v1/deployments/applications/app-a", () => ({
      count: 1,
      deployments: [
        {
          deployment_uuid: "dep-a1",
          status: "finished",
          commit: "abc1234",
          commit_message: "feat: test",
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:02:00Z",
        },
      ],
    }));

    await expect(runCoolifySync(db, { coolify, now })).resolves.toEqual({
      items: 2,
      failures: 0,
    });

    const [env] = await db
      .select()
      .from(schema.siteEnvironments)
      .where(eq(schema.siteEnvironments.id, environment.id));
    expect(env).toMatchObject({ status: "running", statusCheckedAt: now });

    const [deployment] = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.externalId, "dep-a1"));
    expect(deployment).toMatchObject({ status: "succeeded", durationSeconds: 120 });

    expect(await lastRun("coolify")).toMatchObject({ status: "succeeded", items: 2, error: null });
    const [connection] = await db
      .select()
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.service, "coolify"));
    expect(connection).toMatchObject({ status: "connected", lastSuccessAt: now });
  });

  it("accepte aussi la forme documentée, un simple tableau", async () => {
    await linkedEnvironment("app-tableau");
    serveApplications([{ uuid: "app-tableau", status: "running:healthy" }]);
    stub.routes.set("GET /api/v1/deployments/applications/app-tableau", () => [
      { deployment_uuid: "dep-tableau", status: "failed" },
    ]);
    await runCoolifySync(db, { coolify });
    const [deployment] = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.externalId, "dep-tableau"));
    expect(deployment?.status).toBe("failed");
  });

  it("relancer ne crée aucun doublon", async () => {
    const { environment } = await linkedEnvironment("app-idem");
    serveApplications([{ uuid: "app-idem", status: "running:healthy" }]);
    stub.routes.set("GET /api/v1/deployments/applications/app-idem", () => ({
      deployments: [{ deployment_uuid: "dep-idem", status: "finished" }],
    }));
    await runCoolifySync(db, { coolify });
    await runCoolifySync(db, { coolify });
    const rows = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.environmentId, environment.id));
    expect(rows).toHaveLength(1);
    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.entityId, rows[0]?.id ?? ""),
          eq(schema.domainEvents.type, "deployment.finished"),
        ),
      );
    expect(events).toHaveLength(1);
  });

  it("application disparue de Coolify : indisponible et signalée, jamais verte", async () => {
    const { environment } = await linkedEnvironment("app-disparue");
    await db
      .update(schema.siteEnvironments)
      .set({ status: "running" })
      .where(eq(schema.siteEnvironments.id, environment.id));
    serveApplications([]);
    await expect(runCoolifySync(db, { coolify })).resolves.toMatchObject({ failures: 1 });
    const [env] = await db
      .select()
      .from(schema.siteEnvironments)
      .where(eq(schema.siteEnvironments.id, environment.id));
    expect(env?.status).toBe("unknown");
    expect(await lastRun("coolify")).toMatchObject({ status: "failed" });
  });

  it("Coolify en panne : trace d'échec, état local intact", async () => {
    const { environment } = await linkedEnvironment("app-panne");
    await db
      .update(schema.siteEnvironments)
      .set({ status: "running", statusCheckedAt: new Date("2026-11-01T00:00:00Z") })
      .where(eq(schema.siteEnvironments.id, environment.id));
    stub.routes.set("GET /api/v1/applications", () => ({ status: 503 }));

    await expect(runCoolifySync(db, { coolify })).rejects.toBeInstanceOf(ServiceUnavailableError);

    const [env] = await db
      .select()
      .from(schema.siteEnvironments)
      .where(eq(schema.siteEnvironments.id, environment.id));
    expect(env?.statusCheckedAt).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(await lastRun("coolify")).toMatchObject({ status: "failed" });
    const [connection] = await db
      .select()
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.service, "coolify"));
    expect(connection?.status).toBe("unavailable");
  });

  it("jeton refusé : connexion requise", async () => {
    await linkedEnvironment("app-jeton");
    stub.routes.set("GET /api/v1/applications", () => ({ status: 401 }));
    await expect(runCoolifySync(db, { coolify })).rejects.toMatchObject({
      reason: "unauthorized",
      connectionRequired: true,
    });
    const [connection] = await db
      .select()
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.service, "coolify"));
    expect(connection?.status).toBe("not_configured");
  });

  it("non configuré : connexion requise, pas d'appel", async () => {
    await expect(runCoolifySync(db, { coolify: new CoolifyClient(null) })).rejects.toMatchObject({
      reason: "not_configured",
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("une erreur 5xx passagère en lecture est rejouée", async () => {
    await linkedEnvironment("app-reprise");
    let calls = 0;
    stub.routes.set("GET /api/v1/applications", () => {
      calls += 1;
      return calls === 1 ? { status: 502 } : [{ uuid: "app-reprise", status: "running:healthy" }];
    });
    stub.routes.set("GET /api/v1/resources", () => []);
    await expect(runCoolifySync(db, { coolify })).resolves.toBeTruthy();
    expect(calls).toBe(2);
  });

  it("une réservation jamais parvenue à Coolify est soldée", async () => {
    const { environment } = await linkedEnvironment("app-orpheline");
    const [row] = await db
      .insert(schema.deployments)
      .values({
        environmentId: environment.id,
        status: "queued",
        source: "nuera",
        createdAt: new Date("2026-11-04T10:00:00Z"),
      })
      .returning();
    serveApplications([{ uuid: "app-orpheline", status: "running:healthy" }]);
    await runCoolifySync(db, { coolify, now: new Date("2026-11-04T12:00:00Z") });
    const [updated] = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.id, row?.id ?? ""));
    expect(updated?.status).toBe("failed");
  });
});

describe("sauvegardes relues de Coolify", () => {
  function serveBackups(executions: unknown[]) {
    stub.routes.set("GET /api/v1/resources", () => [
      { uuid: "db-1", type: "standalone-postgresql", environment_id: 42 },
      { uuid: "svc", type: "service", environment_id: 42 },
    ]);
    stub.routes.set("GET /api/v1/databases/db-1/backups", () => [{ uuid: "cfg-1", save_s3: true }]);
    stub.routes.set("GET /api/v1/databases/db-1/backups/cfg-1/executions", () => ({ executions }));
  }

  it("attribue une base à l'unique application de son environnement, sans doublon", async () => {
    const { site, environment } = await linkedEnvironment("app-backup");
    stub.routes.set("GET /api/v1/applications", () => [
      { uuid: "app-backup", status: "running:healthy", environment_id: 42 },
    ]);
    serveBackups([
      {
        uuid: "exec-1",
        status: "success",
        size: 1024,
        created_at: "2026-11-04T03:00:00Z",
        s3_uploaded: true,
      },
      // `save_s3` n'est qu'une intention : sans `s3_uploaded`, la copie n'est pas constatée.
      { uuid: "exec-2", status: "success", size: 2048, created_at: "2026-11-03T03:00:00Z" },
      { uuid: "exec-3", status: "failed", created_at: "2026-11-02T03:00:00Z" },
    ]);

    const now = new Date("2026-11-02T12:00:00Z");
    await runCoolifySync(db, { coolify, now });
    await runCoolifySync(db, { coolify, now });

    const rows = await db
      .select()
      .from(schema.siteBackups)
      .where(eq(schema.siteBackups.siteId, site.id));
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((row) => [row.externalId, row]));
    expect(byId.get("exec-1")).toMatchObject({
      status: "succeeded",
      offSite: true,
      source: "coolify",
      environmentId: environment.id,
    });
    expect(byId.get("exec-2")?.offSite).toBe(false);
    expect(byId.get("exec-3")?.status).toBe("failed");

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.type, "backup.failed"),
          eq(schema.domainEvents.entityId, byId.get("exec-3")?.id ?? ""),
        ),
      );
    expect(events).toHaveLength(1);
  });

  it("plusieurs applications reliées dans le même environnement : aucune attribution", async () => {
    const first = await linkedEnvironment("app-amb-1");
    const second = await linkedEnvironment("app-amb-2");
    stub.routes.set("GET /api/v1/applications", () => [
      { uuid: "app-amb-1", status: "running:healthy", environment_id: 42 },
      { uuid: "app-amb-2", status: "running:healthy", environment_id: 42 },
    ]);
    serveBackups([{ uuid: "exec-amb", status: "success", created_at: "2026-11-04T03:00:00Z" }]);

    await runCoolifySync(db, { coolify });

    for (const site of [first.site, second.site]) {
      const rows = await db
        .select()
        .from(schema.siteBackups)
        .where(eq(schema.siteBackups.siteId, site.id));
      expect(rows).toHaveLength(0);
    }
  });

  it("une panne des sauvegardes n'efface pas le reste du passage", async () => {
    const { environment } = await linkedEnvironment("app-partiel");
    stub.routes.set("GET /api/v1/applications", () => [
      { uuid: "app-partiel", status: "running:healthy", environment_id: 9 },
    ]);
    stub.routes.set("GET /api/v1/resources", () => ({ status: 500 }));
    await expect(runCoolifySync(db, { coolify })).resolves.toMatchObject({ failures: 1 });
    const [env] = await db
      .select()
      .from(schema.siteEnvironments)
      .where(eq(schema.siteEnvironments.id, environment.id));
    expect(env?.status).toBe("running");
  });
});

describe("bouton Synchroniser et état affiché", () => {
  it("exige sites:update et trace l'opération", async () => {
    serveApplications([]);
    await expect(syncSitesNow(viewer, { service: "coolify" }, { coolify })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(syncSitesNow(admin, { service: "coolify" }, { coolify })).resolves.toBeTruthy();
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "site.sync_ran"));
    expect(audits.length).toBeGreaterThan(0);
  });

  it("dit si la connexion manque et date la dernière lecture", async () => {
    const unconfigured = await getSitesIntegrationState(viewer, {
      coolify: new CoolifyClient(null),
      uptimeKuma,
    });
    expect(unconfigured.coolify).toMatchObject({ configured: false, consoleUrl: null });

    serveApplications([]);
    await runCoolifySync(db, { coolify });
    const state = await getSitesIntegrationState(viewer, { coolify, uptimeKuma });
    expect(state.coolify.configured).toBe(true);
    expect(state.coolify.lastSuccessAt).toBeInstanceOf(Date);
  });

  it("lien vers Coolify seulement si l'URL et le projet sont connus", () => {
    const site = { coolifyProjectUuid: "projet-1", monitorId: null };
    expect(getConsoleLinks(site, { coolify, uptimeKuma }).coolifyProject).toBe(
      `${stub.url}/project/projet-1`,
    );
    expect(
      getConsoleLinks({ ...site, coolifyProjectUuid: null }, { coolify, uptimeKuma })
        .coolifyProject,
    ).toBeNull();
    expect(
      getConsoleLinks(site, { coolify: new CoolifyClient(null), uptimeKuma }).coolifyProject,
    ).toBeNull();
  });
});

describe("webhook Coolify", () => {
  it("refuse tout secret absent ou faux, à temps constant", () => {
    const secret = "s".repeat(40);
    expect(isValidWebhookToken(secret, secret)).toBe(true);
    expect(isValidWebhookToken("faux", secret)).toBe(false);
    expect(isValidWebhookToken(null, secret)).toBe(false);
    expect(isValidWebhookToken("", "")).toBe(false);
    expect(isValidWebhookToken(secret, undefined)).toBe(false);
  });

  it("reconnaît les événements utiles et ignore le reste", () => {
    expect(
      parseCoolifyWebhook({
        event: "deployment_success",
        success: true,
        deployment_uuid: "d",
        application_uuid: "a",
      }),
    ).toMatchObject({ kind: "deployment" });
    expect(parseCoolifyWebhook({ event: "status_changed", application_uuid: "a" })).toMatchObject({
      kind: "application_status",
    });
    expect(parseCoolifyWebhook({ event: "backup_failed", database_uuid: "x" })).toMatchObject({
      kind: "backup",
    });
    expect(parseCoolifyWebhook({ event: "test" })).toMatchObject({ kind: "ignored" });
    expect(parseCoolifyWebhook({ pas: "un événement" })).toBeNull();
  });

  it("relit l'API au lieu de croire le corps, et ne traite qu'une fois", async () => {
    const { environment } = await linkedEnvironment("app-webhook");
    stub.routes.set("GET /api/v1/deployments/dep-webhook", () => ({
      // Le corps annonce un succès, l'API dit l'échec : l'API fait foi.
      body: { deployment_uuid: "dep-webhook", status: "failed" },
    }));
    const event = parseCoolifyWebhook({
      event: "deployment_success",
      deployment_uuid: "dep-webhook",
      application_uuid: "app-webhook",
    });
    if (!event) throw new Error("Événement illisible");

    await expect(handleCoolifyWebhook(db, event, { coolify })).resolves.toBe("processed");
    await expect(handleCoolifyWebhook(db, event, { coolify })).resolves.toBe("duplicate");

    const rows = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.environmentId, environment.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
  });

  it("application inconnue : reçu ignoré, rien d'écrit", async () => {
    const event = parseCoolifyWebhook({
      event: "deployment_failed",
      deployment_uuid: "dep-inconnu",
      application_uuid: "app-inconnue",
    });
    if (!event) throw new Error("Événement illisible");
    await expect(handleCoolifyWebhook(db, event, { coolify })).resolves.toBe("ignored");
    const rows = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.externalId, "dep-inconnu"));
    expect(rows).toHaveLength(0);
  });

  it("met à jour le statut d'une application arrêtée", async () => {
    const { environment } = await linkedEnvironment("app-arret");
    stub.routes.set("GET /api/v1/applications/app-arret", () => ({
      body: { uuid: "app-arret", status: "exited:unhealthy" },
    }));
    const event = parseCoolifyWebhook({ event: "status_changed", application_uuid: "app-arret" });
    if (!event) throw new Error("Événement illisible");
    await handleCoolifyWebhook(db, event, { coolify });
    const [env] = await db
      .select()
      .from(schema.siteEnvironments)
      .where(eq(schema.siteEnvironments.id, environment.id));
    expect(env?.status).toBe("stopped");
  });

  it("Coolify injoignable : reçu en échec, sans écriture", async () => {
    await linkedEnvironment("app-webhook-panne");
    stub.routes.set("GET /api/v1/deployments/dep-panne", () => ({ status: 503 }));
    const event = parseCoolifyWebhook({
      event: "deployment_success",
      deployment_uuid: "dep-panne",
      application_uuid: "app-webhook-panne",
    });
    if (!event) throw new Error("Événement illisible");
    await expect(handleCoolifyWebhook(db, event, { coolify })).resolves.toBe("failed");
    const [receipt] = await db
      .select()
      .from(schema.webhookReceipts)
      .where(eq(schema.webhookReceipts.externalId, "deployment_success:dep-panne"));
    expect(receipt?.status).toBe("failed");
  });
});
