import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CoolifyClient } from "@/integrations/coolify";
import { parseCoolifyWebhook } from "@/integrations/coolify/coolify.webhook";
import { recordManualBackup } from "@/modules/sites/backup.service";
import { listBusyEnvironmentIds } from "@/modules/sites/deployment.service";
import { handleCoolifyWebhook, runCoolifySync } from "@/modules/sites/coolify-sync.service";
import {
  createDomain,
  listDomains,
  listExpiringDomains,
  runDomainTlsChecks,
  updateDomain,
} from "@/modules/sites/domain.service";
import {
  handleUptimeKumaNotification,
  runUptimeKumaSync,
} from "@/modules/sites/monitoring.service";
import { UptimeKumaClient } from "@/integrations/uptime-kuma";
import {
  activateSiteAfterGoLive,
  createSite as createSiteService,
  getCompanyLinkOptions,
  getSitesOverview,
  listSites,
  saveEnvironment,
  updateSite,
} from "@/modules/sites/site.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createProject,
  createSite,
  createTeamMember,
} from "../../helpers/factories";
import { startHttpStub, type HttpStub } from "./http-stub";

/**
 * Défauts prouvés par l'audit du lot : chacun de ces tests échouait avant sa correction.
 */
const NOW = new Date("2026-11-04T12:00:00Z");

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let stub: HttpStub;
let coolify: CoolifyClient;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createTestContext(db, "admin");
  stub = await startHttpStub();
  coolify = new CoolifyClient({
    baseUrl: stub.url,
    token: "jeton-de-test",
    baseDelayMs: 1,
    timeoutMs: 2000,
    maxRetries: 0,
  });
});

afterEach(async () => {
  stub.routes.clear();
  stub.requests.length = 0;
  await db.update(schema.siteEnvironments).set({ coolifyAppUuid: null });
});

afterAll(async () => {
  await stub.close();
  await close();
});

function siteInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Site essai",
    primaryDomain: "",
    projectId: "",
    contractId: "",
    kind: "",
    technology: "",
    cmsKind: "",
    cmsAdminUrl: "",
    repoUrl: "",
    repoBranch: "",
    hostingLabel: "",
    serverLabel: "",
    ownerMemberId: "",
    liveOn: "",
    coolifyProjectUuid: "",
    monitorId: "",
    ...overrides,
  };
}

async function events(type: string, entityId?: string) {
  const rows = await db
    .select()
    .from(schema.domainEvents)
    .where(eq(schema.domainEvents.type, type));
  return entityId ? rows.filter((row) => row.entityId === entityId) : rows;
}

describe("mise en ligne d'un site déjà en ligne", () => {
  it("rattache quand même le projet, avec audit et sans second site.live", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const site = await createSite(db, { companyId: company.id, status: "live" });

    await db.transaction((tx) =>
      activateSiteAfterGoLive(admin, tx, { projectId: project.id, siteId: site.id }),
    );

    const [row] = await db.select().from(schema.sites).where(eq(schema.sites.id, site.id));
    expect(row?.projectId).toBe(project.id);
    await expect(events("site.live", site.id)).resolves.toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.entityId, site.id), eq(schema.auditLog.action, "site.activated")),
      );
    expect(audits).toHaveLength(1);

    // Rejouer ne change rien.
    await db.transaction((tx) =>
      activateSiteAfterGoLive(admin, tx, { projectId: project.id, siteId: site.id }),
    );
    const again = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.entityId, site.id), eq(schema.auditLog.action, "site.activated")),
      );
    expect(again).toHaveLength(1);
  });
});

describe("correspondance fiable avec les services externes", () => {
  it("une application Coolify ne peut être reliée qu'à un seul environnement", async () => {
    const [a, b] = [await createSite(db), await createSite(db)];
    await saveEnvironment(admin, {
      siteId: a.id,
      kind: "production",
      url: "",
      coolifyAppUuid: "app-partagee",
    });
    await expect(
      saveEnvironment(admin, {
        siteId: b.id,
        kind: "production",
        url: "",
        coolifyAppUuid: "app-partagee",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Le même environnement peut être réenregistré sans changer d'application.
    await expect(
      saveEnvironment(admin, {
        siteId: a.id,
        kind: "production",
        url: "https://a.example",
        coolifyAppUuid: "app-partagee",
      }),
    ).resolves.toMatchObject({ coolifyAppUuid: "app-partagee" });
  });

  it("une sonde ne peut être reliée qu'à un seul site", async () => {
    const company = await createCompany(db);
    const first = await createSite(db, { monitorId: "sonde-unique", companyId: company.id });
    await expect(
      createSiteService(admin, siteInput({ companyId: company.id, monitorId: "sonde-unique" })),
    ).rejects.toBeInstanceOf(ConflictError);

    const other = await createSite(db, { companyId: company.id });
    await expect(
      updateSite(admin, siteInput({ id: other.id, monitorId: "sonde-unique" })),
    ).rejects.toBeInstanceOf(ConflictError);

    // Sa propre sonde reste acceptée. Un site archivé ne la retient plus.
    await expect(
      updateSite(admin, siteInput({ id: first.id, monitorId: "sonde-unique" })),
    ).resolves.toMatchObject({ monitorId: "sonde-unique" });
    await db
      .update(schema.sites)
      .set({ status: "archived", archivedAt: NOW })
      .where(eq(schema.sites.id, first.id));
    await expect(
      updateSite(admin, siteInput({ id: other.id, monitorId: "sonde-unique" })),
    ).resolves.toMatchObject({ monitorId: "sonde-unique" });
  });
});

describe("site archivé", () => {
  async function archivedSite() {
    return createSite(db, { status: "archived", archivedAt: NOW });
  }

  it("ne se modifie plus", async () => {
    const site = await archivedSite();
    await expect(
      updateSite(admin, siteInput({ id: site.id, name: "Renommé" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("ne reçoit plus de domaine", async () => {
    const site = await archivedSite();
    await expect(
      createDomain(admin, {
        companyId: site.companyId,
        siteId: site.id,
        name: `archive-${site.id.slice(0, 8)}.example`,
        registrar: "",
        expiresOn: "",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const active = await createSite(db, { companyId: site.companyId, primaryDomain: null });
    const domain = await createDomain(admin, {
      companyId: site.companyId,
      siteId: active.id,
      name: `actif-${active.id.slice(0, 8)}.example`,
      registrar: "",
      expiresOn: "",
    });
    await expect(
      updateDomain(admin, {
        id: domain.id,
        siteId: site.id,
        registrar: "",
        expiresOn: "",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("n'alerte plus sur ses domaines et ne fait plus partie des contrôles planifiés", async () => {
    const site = await archivedSite();
    const name = `alerte-${site.id.slice(0, 8)}.example`;
    await db.insert(schema.domains).values({
      companyId: site.companyId,
      siteId: site.id,
      name,
      expiresOn: "2026-11-10",
    });

    const expiring = await listExpiringDomains(db, NOW);
    expect(expiring.map((domain) => domain.name)).not.toContain(name);

    const seen: string[] = [];
    await runDomainTlsChecks(db, {
      now: NOW,
      tls: {
        lookup: (host) => {
          seen.push(host);
          return Promise.reject(new Error("pas de réseau en test"));
        },
      },
    });
    expect(seen).not.toContain(name);

    const filtered = await listDomains(
      admin,
      { search: name, filter: "expiring" },
      {
        page: 1,
        pageSize: 5,
      },
      NOW,
    );
    expect(filtered.total).toBe(0);

    // Il reste visible au registre, signalé comme tel : le nom reste réservé.
    const listed = await listDomains(admin, { search: name }, { page: 1, pageSize: 5 }, NOW);
    expect(listed.items[0]).toMatchObject({ name, siteArchived: true });
  });
});

describe("saisies refusées proprement", () => {
  it("refuse un client archivé pour un site et pour un domaine", async () => {
    const company = await createCompany(db, { archivedAt: NOW });
    await expect(
      createSiteService(admin, siteInput({ companyId: company.id })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createDomain(admin, {
        companyId: company.id,
        siteId: "",
        name: `client-archive-${company.id.slice(0, 8)}.example`,
        registrar: "",
        expiresOn: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("un responsable inconnu est une erreur de champ, pas une erreur interne", async () => {
    const company = await createCompany(db);
    await expect(
      createSiteService(
        admin,
        siteInput({
          companyId: company.id,
          ownerMemberId: "00000000-0000-4000-8000-000000000001",
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("un responsable parti reste accepté tant qu'il ne change pas", async () => {
    const member = await createTeamMember(db, { status: "inactive" });
    const site = await createSite(db, { ownerMemberId: member.id });
    await expect(
      updateSite(admin, siteInput({ id: site.id, ownerMemberId: member.id })),
    ).resolves.toMatchObject({ ownerMemberId: member.id });

    const other = await createSite(db);
    await expect(
      updateSite(admin, siteInput({ id: other.id, ownerMemberId: member.id })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("registre", () => {
  it("n'affiche jamais l'échéance du domaine d'un autre client", async () => {
    const owner = await createCompany(db);
    const other = await createCompany(db);
    const name = `homonyme-${owner.id.slice(0, 8)}.example`;
    const site = await createSite(db, { companyId: owner.id, primaryDomain: name });
    await db.insert(schema.domains).values({
      companyId: other.id,
      name,
      expiresOn: "2030-01-01",
      tlsStatus: "expired",
    });

    const { items } = await listSites(
      admin,
      { companyId: owner.id },
      { page: 1, pageSize: 5 },
      NOW,
    );
    expect(items.find((row) => row.id === site.id)).toMatchObject({
      domainExpiresOn: null,
      tlsStatus: null,
    });
  });

  it("le formulaire d'un domaine liste les sites du client, sans les archives", async () => {
    const company = await createCompany(db);
    const active = await createSite(db, { companyId: company.id });
    await createSite(db, { companyId: company.id, archivedAt: NOW, status: "archived" });
    const options = await getCompanyLinkOptions(admin, company.id);
    expect(options.sites.map((site) => site.id)).toEqual([active.id]);
  });

  it("l'aperçu reste lisible par tous les rôles internes", async () => {
    await expect(getSitesOverview(admin)).resolves.toHaveProperty("total");
  });
});

describe("déclaration manuelle d'une sauvegarde", () => {
  it("rejouée, elle ne crée ni seconde ligne ni second événement", async () => {
    const site = await createSite(db);
    const input = {
      siteId: site.id,
      environmentId: "",
      status: "failed",
      takenAt: "2026-11-03T03:00:00.000Z",
      sizeBytes: "",
    };
    const first = await recordManualBackup(admin, input);
    const second = await recordManualBackup(admin, input);
    expect(second.id).toBe(first.id);
    const rows = await db
      .select()
      .from(schema.siteBackups)
      .where(eq(schema.siteBackups.siteId, site.id));
    expect(rows).toHaveLength(1);
    await expect(events("backup.failed", first.id)).resolves.toHaveLength(1);
  });

  it("n'accepte pas l'état « en cours », qu'aucun geste ne pourrait solder", async () => {
    const site = await createSite(db);
    await expect(
      recordManualBackup(admin, {
        siteId: site.id,
        environmentId: "",
        status: "running",
        takenAt: "2026-11-03T03:00:00.000Z",
        sizeBytes: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("historique relu pour la première fois", () => {
  it("n'annonce pas d'anciens déploiements ni d'anciennes sauvegardes en échec", async () => {
    const site = await createSite(db);
    const [environment] = await db
      .insert(schema.siteEnvironments)
      .values({ siteId: site.id, kind: "production", coolifyAppUuid: "app-historique" })
      .returning();
    if (!environment) throw new Error("Environnement non créé");

    stub.routes.set("GET /api/v1/applications", () => [
      { uuid: "app-historique", status: "running:healthy", environment_id: 77 },
    ]);
    stub.routes.set("GET /api/v1/resources", () => [
      { uuid: "db-historique", type: "standalone-postgresql", environment_id: 77 },
    ]);
    stub.routes.set("GET /api/v1/databases/db-historique/backups", () => [
      { uuid: "cfg-historique" },
    ]);
    stub.routes.set("GET /api/v1/databases/db-historique/backups/cfg-historique/executions", () => [
      {
        uuid: "exec-ancienne",
        status: "failed",
        created_at: "2026-10-01T03:00:00Z",
      },
      {
        uuid: "exec-recente",
        status: "failed",
        created_at: "2026-11-04T03:00:00Z",
      },
    ]);
    stub.routes.set("GET /api/v1/deployments/applications/app-historique", () => ({
      deployments: [
        {
          deployment_uuid: "dep-recent",
          status: "finished",
          created_at: "2026-11-04T10:00:00Z",
          updated_at: "2026-11-04T10:02:00Z",
        },
        {
          deployment_uuid: "dep-ancien",
          status: "finished",
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-01T10:02:00Z",
        },
      ],
    }));

    await runCoolifySync(db, { coolify, now: NOW });

    const rows = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.environmentId, environment.id));
    expect(rows).toHaveLength(2);
    const recent = rows.find((row) => row.externalId === "dep-recent");
    const old = rows.find((row) => row.externalId === "dep-ancien");
    await expect(events("deployment.finished", recent?.id)).resolves.toHaveLength(1);
    await expect(events("deployment.finished", old?.id)).resolves.toHaveLength(0);

    const backups = await db
      .select()
      .from(schema.siteBackups)
      .where(eq(schema.siteBackups.siteId, site.id));
    expect(backups).toHaveLength(2);
    const recentBackup = backups.find((row) => row.externalId === "exec-recente");
    const oldBackup = backups.find((row) => row.externalId === "exec-ancienne");
    await expect(events("backup.failed", recentBackup?.id)).resolves.toHaveLength(1);
    await expect(events("backup.failed", oldBackup?.id)).resolves.toHaveLength(0);
  });

  it("un déploiement suivi en direct est annoncé même s'il a duré longtemps", async () => {
    const site = await createSite(db);
    const [environment] = await db
      .insert(schema.siteEnvironments)
      .values({ siteId: site.id, kind: "production", coolifyAppUuid: "app-long" })
      .returning();
    if (!environment) throw new Error("Environnement non créé");
    const [row] = await db
      .insert(schema.deployments)
      .values({
        environmentId: environment.id,
        externalId: "dep-long",
        status: "running",
        startedAt: new Date("2026-11-01T10:00:00Z"),
      })
      .returning();
    stub.routes.set("GET /api/v1/applications", () => [
      { uuid: "app-long", status: "running:healthy" },
    ]);
    stub.routes.set("GET /api/v1/resources", () => []);
    stub.routes.set("GET /api/v1/deployments/applications/app-long", () => [
      {
        deployment_uuid: "dep-long",
        status: "failed",
        created_at: "2026-11-01T10:00:00Z",
        updated_at: "2026-11-01T10:30:00Z",
      },
    ]);
    await runCoolifySync(db, { coolify, now: NOW });
    await expect(events("deployment.finished", row?.id)).resolves.toHaveLength(1);
  });
});

describe("état du bouton Déployer", () => {
  it("signale les environnements en cours, sans la ligne perdue ni le déjà fini", async () => {
    const site = await createSite(db);
    const [production, staging] = await db
      .insert(schema.siteEnvironments)
      .values([
        { siteId: site.id, kind: "production", coolifyAppUuid: "app-occupee" },
        { siteId: site.id, kind: "staging", coolifyAppUuid: "app-oubliee" },
      ])
      .returning();
    if (!production || !staging) throw new Error("Environnements non créés");
    await db.insert(schema.deployments).values([
      {
        environmentId: production.id,
        externalId: "dep-occupe",
        status: "running",
        startedAt: new Date(NOW.getTime() - 60_000),
      },
      {
        environmentId: production.id,
        externalId: "dep-fini",
        status: "succeeded",
        startedAt: new Date(NOW.getTime() - 120_000),
      },
      {
        // Coolify a perdu ce déploiement : il ne bloque plus rien au-delà du verrou.
        environmentId: staging.id,
        externalId: "dep-perdu",
        status: "running",
        startedAt: new Date(NOW.getTime() - 3 * 3_600_000),
      },
    ]);
    await expect(listBusyEnvironmentIds(admin, site.id, NOW)).resolves.toEqual([production.id]);
  });
});

describe("webhook Coolify", () => {
  it("une notification en échec peut être retraitée quand Coolify la renvoie", async () => {
    const site = await createSite(db);
    const [environment] = await db
      .insert(schema.siteEnvironments)
      .values({ siteId: site.id, kind: "production", coolifyAppUuid: "app-reprise" })
      .returning();
    if (!environment) throw new Error("Environnement non créé");
    const event = parseCoolifyWebhook({
      event: "deployment_success",
      deployment_uuid: "dep-reprise",
      application_uuid: "app-reprise",
    });
    if (!event) throw new Error("Événement illisible");

    stub.routes.set("GET /api/v1/deployments/dep-reprise", () => ({ status: 503 }));
    await expect(handleCoolifyWebhook(db, event, { coolify, now: NOW })).resolves.toBe("failed");

    stub.routes.set("GET /api/v1/deployments/dep-reprise", () => ({
      body: { deployment_uuid: "dep-reprise", status: "finished" },
    }));
    await expect(handleCoolifyWebhook(db, event, { coolify, now: NOW })).resolves.toBe("processed");
    await expect(handleCoolifyWebhook(db, event, { coolify, now: NOW })).resolves.toBe("duplicate");

    const rows = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.externalId, "dep-reprise"));
    expect(rows).toHaveLength(1);
  });

  it("deux changements d'état dans la même minute sont tous deux relus", async () => {
    const site = await createSite(db);
    const [environment] = await db
      .insert(schema.siteEnvironments)
      .values({ siteId: site.id, kind: "production", coolifyAppUuid: "app-minute" })
      .returning();
    if (!environment) throw new Error("Environnement non créé");
    const event = parseCoolifyWebhook({ event: "status_changed", application_uuid: "app-minute" });
    if (!event) throw new Error("Événement illisible");

    stub.routes.set("GET /api/v1/applications/app-minute", () => ({
      body: { uuid: "app-minute", status: "running:healthy" },
    }));
    await handleCoolifyWebhook(db, event, { coolify, now: new Date("2026-11-04T12:00:01Z") });

    stub.routes.set("GET /api/v1/applications/app-minute", () => ({
      body: { uuid: "app-minute", status: "exited:unhealthy" },
    }));
    await handleCoolifyWebhook(db, event, { coolify, now: new Date("2026-11-04T12:00:30Z") });

    const [row] = await db
      .select()
      .from(schema.siteEnvironments)
      .where(eq(schema.siteEnvironments.id, environment.id));
    expect(row?.status).toBe("stopped");
  });
});

describe("surveillance", () => {
  const HEARTBEAT = "GET /api/status-page/heartbeat/nuera";
  const uptimeKuma = () => new UptimeKumaClient({ baseUrl: stub.url, statusSlug: "nuera" });
  let monitorCounter = 900;

  function serveDown(monitorId: string) {
    stub.routes.set(HEARTBEAT, () => ({
      heartbeatList: { [monitorId]: [{ status: 0, time: "2026-11-04 11:59:00.000", ping: null }] },
      uptimeList: { [`${monitorId}_24`]: 0.5 },
    }));
  }

  it.each(["paused", "planned", "staging"] as const)(
    "un site %s n'ouvre ni panne ni incident, mais garde sa mesure",
    async (status) => {
      monitorCounter += 1;
      const monitorId = String(monitorCounter);
      const site = await createSite(db, { monitorId, status });
      serveDown(monitorId);
      await runUptimeKumaSync(db, { uptimeKuma: uptimeKuma(), now: NOW });
      await expect(events("site.down", site.id)).resolves.toHaveLength(0);
      const tickets = await db
        .select()
        .from(schema.tickets)
        .where(eq(schema.tickets.siteId, site.id));
      expect(tickets).toHaveLength(0);
      const samples = await db
        .select()
        .from(schema.siteUptimeSamples)
        .where(eq(schema.siteUptimeSamples.siteId, site.id));
      expect(samples).toHaveLength(1);
    },
  );

  it("une notification plus ancienne que le dernier état connu est ignorée", async () => {
    monitorCounter += 1;
    const monitorId = String(monitorCounter);
    const site = await createSite(db, { monitorId, status: "live" });

    await handleUptimeKumaNotification(
      db,
      { monitorId, state: "down", at: new Date("2026-11-04T11:00:00Z") },
      NOW,
    );
    await expect(
      handleUptimeKumaNotification(
        db,
        { monitorId, state: "up", at: new Date("2026-11-04T10:00:00Z") },
        NOW,
      ),
    ).resolves.toBe("unchanged");
    await expect(events("site.up", site.id)).resolves.toHaveLength(0);

    await expect(
      handleUptimeKumaNotification(
        db,
        { monitorId, state: "up", at: new Date("2026-11-04T11:30:00Z") },
        NOW,
      ),
    ).resolves.toBe("applied");
    await expect(events("site.up", site.id)).resolves.toHaveLength(1);
  });
});
