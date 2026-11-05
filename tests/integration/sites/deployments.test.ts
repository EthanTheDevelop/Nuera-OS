import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CoolifyClient } from "@/integrations/coolify";
import { mapApplicationStatus, mapDeploymentStatus } from "@/integrations/coolify/coolify.mappers";
import {
  applyExternalDeployment,
  listSiteDeployments,
  refreshSiteDeployments,
  triggerDeployment,
} from "@/modules/sites/deployment.service";
import { saveEnvironment } from "@/modules/sites/site.service";
import { DEPLOYMENT_TRANSITIONS, canDeploymentTransition } from "@/modules/sites/site.status";
import { DEPLOYMENT_STATUSES } from "@/lib/domain-enums";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  ConflictError,
  ForbiddenError,
  IntegrationError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createSite } from "../../helpers/factories";
import { startHttpStub, type HttpStub } from "./http-stub";

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let member: ServiceContext;
let viewer: ServiceContext;
let contractor: ServiceContext;
let stub: HttpStub;
let coolify: CoolifyClient;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  [admin, member, viewer, contractor] = await Promise.all([
    createTestContext(db, "admin"),
    createTestContext(db, "member"),
    createTestContext(db, "viewer"),
    createTestContext(db, "contractor"),
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
  // Une application n'a qu'un environnement : chaque test relie la sienne.
  await db.update(schema.siteEnvironments).set({ coolifyAppUuid: null });
});

afterAll(async () => {
  await stub.close();
  await close();
});

async function environmentOf(kind: "production" | "staging" | "development", app: string | null) {
  const site = await createSite(db);
  const environment = await saveEnvironment(member, {
    siteId: site.id,
    kind,
    url: "https://example.fr",
    coolifyAppUuid: app,
  });
  return { site, environment };
}

function acceptDeploy(uuid = "dep-1") {
  stub.routes.set("POST /api/v1/deploy", ({ url }) => ({
    body: {
      deployments: [
        {
          message: "Deployment request queued.",
          resource_uuid: url.searchParams.get("uuid"),
          deployment_uuid: uuid,
        },
      ],
    },
  }));
}

async function audits(entityId: string) {
  return db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));
}

const deployCalls = () => stub.requests.filter((request) => request.method === "POST");

describe("déclencher un déploiement : droits", () => {
  it.each([
    ["member", () => member],
    ["viewer", () => viewer],
    ["contractor", () => contractor],
  ])("%s est refusé, sans appel à Coolify", async (_, context) => {
    const { environment } = await environmentOf("staging", "app-droits");
    acceptDeploy();
    await expect(
      triggerDeployment(
        context(),
        { environmentId: environment.id, confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(deployCalls()).toHaveLength(0);
  });

  it("deployments:read reste nécessaire pour lire, et le prestataire ne lit rien", async () => {
    const { site } = await environmentOf("staging", null);
    await expect(
      listSiteDeployments(viewer, site.id, { page: 1, pageSize: 10 }),
    ).resolves.toBeTruthy();
    await expect(
      listSiteDeployments(contractor, site.id, { page: 1, pageSize: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      listSiteDeployments(viewer, crypto.randomUUID(), { page: 1, pageSize: 10 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("déclencher un déploiement : confirmation côté serveur", () => {
  it.each([[undefined], [""], ["CONFIRMED"], ["production"], ["PRODUCTION "]])(
    "production refuse la confirmation %j, sans rien écrire ni appeler",
    async (confirmation) => {
      const { environment } = await environmentOf("production", "app-prod-refus");
      acceptDeploy();
      await expect(
        triggerDeployment(admin, { environmentId: environment.id, confirmation }, { coolify }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(deployCalls()).toHaveLength(0);
      const rows = await db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.environmentId, environment.id));
      expect(rows).toHaveLength(0);
    },
  );

  it("production accepte le mot exact, audite et appelle l'API officielle", async () => {
    const { site, environment } = await environmentOf("production", "app-prod-ok");
    acceptDeploy("dep-prod");
    const deployment = await triggerDeployment(
      admin,
      { environmentId: environment.id, confirmation: "PRODUCTION" },
      { coolify },
    );
    expect(deployment).toMatchObject({
      externalId: "dep-prod",
      status: "queued",
      source: "nuera",
      triggeredByUserId: admin.actor.userId,
    });

    const [call] = deployCalls();
    expect(call?.path).toBe("/api/v1/deploy?uuid=app-prod-ok&force=false");
    expect(call?.authorization).toBe("Bearer jeton-de-test");

    const [audit] = await audits(deployment.id);
    expect(audit?.action).toBe("deployment.triggered");
    expect(audit?.metadata).toMatchObject({
      siteId: site.id,
      environmentKind: "production",
      production: true,
    });
  });

  it("les autres environnements demandent une confirmation simple", async () => {
    const { environment } = await environmentOf("staging", "app-staging");
    acceptDeploy("dep-staging");
    await expect(
      triggerDeployment(admin, { environmentId: environment.id }, { coolify }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      triggerDeployment(
        admin,
        { environmentId: environment.id, confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).resolves.toMatchObject({ externalId: "dep-staging" });
  });
});

describe("déclencher un déploiement : règles et échecs", () => {
  it("un second déclenchement est refusé tant que le premier est en cours", async () => {
    const { environment } = await environmentOf("staging", "app-double");
    acceptDeploy("dep-double");
    const input = { environmentId: environment.id, confirmation: "CONFIRMED" };
    await triggerDeployment(admin, input, { coolify });
    await expect(triggerDeployment(admin, input, { coolify })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(deployCalls()).toHaveLength(1);
  });

  it("deux demandes simultanées ne partent qu'une fois", async () => {
    const { environment } = await environmentOf("staging", "app-simultane");
    acceptDeploy("dep-simultane");
    const input = { environmentId: environment.id, confirmation: "CONFIRMED" };
    const results = await Promise.allSettled([
      triggerDeployment(admin, input, { coolify }),
      triggerDeployment(admin, input, { coolify }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(deployCalls()).toHaveLength(1);
  });

  it("environnement sans application : refusé", async () => {
    const { environment } = await environmentOf("staging", null);
    await expect(
      triggerDeployment(
        admin,
        { environmentId: environment.id, confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("environnement inconnu : 404", async () => {
    await expect(
      triggerDeployment(
        admin,
        { environmentId: crypto.randomUUID(), confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("site archivé : refusé", async () => {
    const { site, environment } = await environmentOf("staging", "app-archive");
    await db
      .update(schema.sites)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(schema.sites.id, site.id));
    await expect(
      triggerDeployment(
        admin,
        { environmentId: environment.id, confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("Coolify non configuré : connexion requise, aucune ligne, aucun succès simulé", async () => {
    const { environment } = await environmentOf("production", "app-non-configure");
    await expect(
      triggerDeployment(
        admin,
        { environmentId: environment.id, confirmation: "PRODUCTION" },
        { coolify: new CoolifyClient(null) },
      ),
    ).rejects.toMatchObject({ reason: "not_configured", connectionRequired: true });
    const rows = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.environmentId, environment.id));
    expect(rows).toHaveLength(0);
  });

  it("Coolify refuse : la ligne passe en échec, l'audit le dit, on peut réessayer", async () => {
    const { environment } = await environmentOf("production", "app-refus");
    stub.routes.set("POST /api/v1/deploy", () => ({ status: 500, body: { message: "boom" } }));
    const input = { environmentId: environment.id, confirmation: "PRODUCTION" };
    await expect(triggerDeployment(admin, input, { coolify })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    // Un déploiement n'est jamais rejoué de lui-même.
    expect(deployCalls()).toHaveLength(1);

    const [row] = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.environmentId, environment.id));
    expect(row?.status).toBe("failed");
    const actions = (await audits(row?.id ?? "")).map((audit) => audit.action);
    expect(actions).toEqual(
      expect.arrayContaining(["deployment.triggered", "deployment.trigger_failed"]),
    );

    acceptDeploy("dep-reprise");
    await expect(triggerDeployment(admin, input, { coolify })).resolves.toMatchObject({
      externalId: "dep-reprise",
    });
  });

  it("file pleine (429) : message clair, pas de nouvelle tentative", async () => {
    const { environment } = await environmentOf("staging", "app-file");
    stub.routes.set("POST /api/v1/deploy", () => ({
      status: 429,
      headers: { "retry-after": "60" },
      body: { message: "queue full" },
    }));
    await expect(
      triggerDeployment(
        admin,
        { environmentId: environment.id, confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).rejects.toMatchObject({ reason: "rate_limited", retryAfterMs: 60_000 });
    expect(deployCalls()).toHaveLength(1);
  });

  it("réponse sans identifiant de déploiement : échec, pas de succès supposé", async () => {
    const { environment } = await environmentOf("staging", "app-sans-id");
    stub.routes.set("POST /api/v1/deploy", () => ({
      body: { deployments: [{ message: "No resources found.", resource_uuid: "x" }] },
    }));
    await expect(
      triggerDeployment(
        admin,
        { environmentId: environment.id, confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).rejects.toBeInstanceOf(IntegrationError);
  });

  it("le déploiement relu entre-temps est fusionné, sans doublon", async () => {
    const { site, environment } = await environmentOf("staging", "app-course");
    acceptDeploy("dep-course");
    await applyExternalDeployment(
      db,
      { environmentId: environment.id, siteId: site.id, companyId: site.companyId },
      {
        deployment_uuid: "dep-course",
        status: "in_progress",
        created_at: new Date().toISOString(),
      },
    );
    // Ligne déjà active, relue par la synchronisation : elle bloque le déclenchement.
    await expect(
      triggerDeployment(
        admin,
        { environmentId: environment.id, confirmation: "CONFIRMED" },
        { coolify },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("machine à états des déploiements", () => {
  const paths = DEPLOYMENT_STATUSES.flatMap((from) =>
    DEPLOYMENT_STATUSES.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it.each(paths)("%s → %s", (from, to) => {
    expect(canDeploymentTransition(from, to)).toBe(DEPLOYMENT_TRANSITIONS[from].includes(to));
  });

  it("un état final ne bouge plus", () => {
    for (const status of ["succeeded", "failed", "cancelled"] as const) {
      expect(DEPLOYMENT_TRANSITIONS[status]).toEqual([]);
    }
  });
});

describe("application d'une relecture de Coolify", () => {
  async function target() {
    const { site, environment } = await environmentOf("production", null);
    return { environmentId: environment.id, siteId: site.id, companyId: site.companyId };
  }

  async function finishedEvents(id: string) {
    const rows = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.entityId, id));
    return rows.filter((event) => event.type === "deployment.finished");
  }

  it("relire deux fois ne crée ni doublon ni second événement", async () => {
    const t = await target();
    // Horloge fixée : au-delà de la fenêtre de fraîcheur, le déploiement relu est de l'historique, sans événement.
    const now = new Date("2026-11-04T10:02:00Z");
    const external = {
      deployment_uuid: `dep-${crypto.randomUUID()}`,
      status: "finished",
      commit: "a3f9c12deadbeef",
      commit_message: "feat: horaires\n\ncorps du message",
      created_at: "2026-11-04T10:00:00Z",
      updated_at: "2026-11-04T10:01:12Z",
    };
    await expect(applyExternalDeployment(db, t, external, now)).resolves.toMatchObject({
      created: true,
    });
    await expect(applyExternalDeployment(db, t, external, now)).resolves.toEqual({
      created: false,
      changed: false,
    });

    const [row] = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.externalId, external.deployment_uuid));
    expect(row).toMatchObject({
      status: "succeeded",
      durationSeconds: 72,
      commitMessage: "feat: horaires",
      source: "coolify",
      triggeredByUserId: null,
    });
    expect(await finishedEvents(row?.id ?? "")).toHaveLength(1);
  });

  it("une relecture ancienne n'écrase pas un état final", async () => {
    const t = await target();
    const uuid = `dep-${crypto.randomUUID()}`;
    await applyExternalDeployment(db, t, { deployment_uuid: uuid, status: "failed" });
    await applyExternalDeployment(db, t, { deployment_uuid: uuid, status: "in_progress" });
    const [row] = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.externalId, uuid));
    expect(row?.status).toBe("failed");
  });

  it("suit queued → running → réussi, et n'annonce la fin qu'à la fin", async () => {
    const t = await target();
    const uuid = `dep-${crypto.randomUUID()}`;
    await applyExternalDeployment(db, t, { deployment_uuid: uuid, status: "queued" });
    await applyExternalDeployment(db, t, { deployment_uuid: uuid, status: "in_progress" });
    const [running] = await db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.externalId, uuid));
    expect(running?.status).toBe("running");
    expect(await finishedEvents(running?.id ?? "")).toHaveLength(0);

    await applyExternalDeployment(db, t, { deployment_uuid: uuid, status: "finished" });
    expect(await finishedEvents(running?.id ?? "")).toHaveLength(1);
  });

  it("un statut inconnu ne change rien", async () => {
    const t = await target();
    await expect(
      applyExternalDeployment(db, t, { deployment_uuid: "dep-inconnu", status: "bizarre" }),
    ).resolves.toEqual({ created: false, changed: false });
  });
});

describe("suivi depuis la fiche", () => {
  it("relit les déploiements actifs, puis s'arrête", async () => {
    const { site, environment } = await environmentOf("staging", "app-suivi");
    acceptDeploy("dep-suivi");
    await triggerDeployment(
      admin,
      { environmentId: environment.id, confirmation: "CONFIRMED" },
      { coolify },
    );

    stub.routes.set("GET /api/v1/deployments/dep-suivi", () => ({
      body: { deployment_uuid: "dep-suivi", status: "in_progress" },
    }));
    await expect(refreshSiteDeployments(viewer, site.id, { coolify })).resolves.toMatchObject({
      active: true,
      changed: true,
    });

    stub.routes.set("GET /api/v1/deployments/dep-suivi", () => ({
      body: { deployment_uuid: "dep-suivi", status: "finished" },
    }));
    await expect(refreshSiteDeployments(viewer, site.id, { coolify })).resolves.toEqual({
      active: false,
      changed: true,
    });
    await expect(refreshSiteDeployments(viewer, site.id, { coolify })).resolves.toEqual({
      active: false,
      changed: false,
    });
  });

  it("Coolify injoignable : l'état local reste, rien n'est inventé", async () => {
    const { site, environment } = await environmentOf("staging", "app-panne");
    acceptDeploy("dep-panne");
    await triggerDeployment(
      admin,
      { environmentId: environment.id, confirmation: "CONFIRMED" },
      { coolify },
    );
    stub.routes.set("GET /api/v1/deployments/dep-panne", () => ({ status: 503 }));
    await expect(refreshSiteDeployments(viewer, site.id, { coolify })).resolves.toEqual({
      active: true,
      changed: false,
    });
  });

  it("le prestataire n'y a pas accès", async () => {
    const { site } = await environmentOf("staging", null);
    await expect(refreshSiteDeployments(contractor, site.id, { coolify })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("traductions Coolify", () => {
  it.each([
    ["running:healthy", "running"],
    ["running:unknown", "running"],
    ["running:unhealthy", "error"],
    ["exited:unhealthy", "stopped"],
    ["stopped", "stopped"],
    ["degraded:unhealthy", "error"],
    ["restarting:unknown", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
    ["nouvelle-valeur", "unknown"],
  ])("application %j → %s", (status, expected) => {
    expect(mapApplicationStatus(status)).toBe(expected);
  });

  it.each([
    ["queued", "queued"],
    ["in_progress", "running"],
    ["finished", "succeeded"],
    ["failed", "failed"],
    ["cancelled-by-user", "cancelled"],
    ["autre", null],
  ])("déploiement %s → %s", (status, expected) => {
    expect(mapDeploymentStatus(status)).toBe(expected);
  });
});
