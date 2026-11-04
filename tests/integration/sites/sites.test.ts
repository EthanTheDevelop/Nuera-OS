import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateSiteAfterGoLive,
  assertSiteExists,
  changeSiteStatus,
  createSite,
  getSite,
  getSiteHealth,
  getSitesHealthSummary,
  getSitesOverview,
  listSites,
  listSitesForCompany,
  saveEnvironment,
  summarizeSites,
  updateSite,
} from "@/modules/sites/site.service";
import {
  liveCheck,
  siteHealthBadge,
  tlsBadge,
  environmentBadge,
} from "@/modules/sites/site.health";
import { SITE_TRANSITIONS } from "@/modules/sites/site.status";
import { ForbiddenError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { SITE_STATUSES, type SiteStatus } from "@/lib/domain-enums";
import * as schema from "@/server/db/schema";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createProject,
  createSite as createSiteRow,
} from "../../helpers/factories";

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let member: ServiceContext;
let viewer: ServiceContext;
let contractor: ServiceContext;
let client: ServiceContext;

const page = { page: 1, pageSize: 25 };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  [admin, member, viewer, contractor, client] = await Promise.all([
    createTestContext(db, "admin"),
    createTestContext(db, "member"),
    createTestContext(db, "viewer"),
    createTestContext(db, "contractor"),
    createTestContext(db, "client"),
  ]);
});

afterAll(() => close());

async function auditActions(entityId: string) {
  const rows = await db
    .select({ action: schema.auditLog.action })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.entityId, entityId));
  return rows.map((row) => row.action);
}

describe("droits", () => {
  it.each([
    ["viewer", () => viewer],
    ["member", () => member],
    ["admin", () => admin],
  ])("%s lit le registre", async (_, context) => {
    await expect(listSites(context(), {}, page)).resolves.toBeTruthy();
  });

  it.each([
    ["contractor", () => contractor],
    ["client", () => client],
  ])("%s ne lit rien, liste, fiche ni santé", async (_, context) => {
    const site = await createSiteRow(db);
    await expect(listSites(context(), {}, page)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSite(context(), site.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSiteHealth(context(), site.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listSitesForCompany(context(), site.companyId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("viewer ne peut ni créer, ni modifier, ni changer un statut", async () => {
    const company = await createCompany(db);
    const site = await createSiteRow(db, { companyId: company.id });
    await expect(createSite(viewer, { companyId: company.id, name: "Non" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(updateSite(viewer, { id: site.id, name: "Non" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(changeSiteStatus(viewer, { id: site.id, status: "live" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("un site inconnu répond 404", async () => {
    await expect(getSite(admin, crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("le contrôle au-dessus du chargement distingue inconnu, illisible et interdit", async () => {
    const site = await createSiteRow(db);
    await expect(assertSiteExists(viewer, site.id)).resolves.toBeUndefined();
    await expect(assertSiteExists(viewer, crypto.randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(assertSiteExists(viewer, "pas-un-id")).rejects.toBeInstanceOf(ValidationError);
    await expect(assertSiteExists(contractor, site.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("badge du certificat", () => {
  it("un contrôle en échec ne prétend pas avoir lu un certificat", () => {
    expect(
      tlsBadge({ tlsStatus: "error", tlsExpiresOn: null, checkedAt: new Date() }, new Date()),
    ).toEqual({ label: "contrôle en échec", tone: "danger" });
  });
});

describe("création et modification", () => {
  it("crée le site, sa fiche de domaine et l'audit dans la même opération", async () => {
    const company = await createCompany(db);
    const site = await createSite(member, {
      companyId: company.id,
      name: "Atelier",
      primaryDomain: "ATELIER-Test-1.example.fr",
      hostedByNuera: "on",
    });
    expect(site.status).toBe("planned");
    expect(site.primaryDomain).toBe("atelier-test-1.example.fr");
    const detail = await getSite(member, site.id);
    expect(detail.primaryDomain?.name).toBe("atelier-test-1.example.fr");
    expect(detail.primaryDomain?.companyId).toBe(company.id);
    expect(await auditActions(site.id)).toContain("site.created");
  });

  it("refuse un domaine, un dépôt ou un CMS mal formés", async () => {
    const company = await createCompany(db);
    await expect(
      createSite(member, { companyId: company.id, name: "X", primaryDomain: "pas un domaine" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createSite(member, {
        companyId: company.id,
        name: "X",
        // Ce lien serait cliquable : seuls http et https passent.
        cmsAdminUrl: "javascript:alert(1)",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse le projet ou le contrat d'un autre client", async () => {
    const [mine, other] = [await createCompany(db), await createCompany(db)];
    const foreignProject = await createProject(db, { companyId: other.id });
    const foreignContract = await createContract(db, { companyId: other.id });
    await expect(
      createSite(member, { companyId: mine.id, name: "X", projectId: foreignProject.id }),
    ).rejects.toMatchObject({ fieldErrors: { projectId: [expect.any(String)] } });
    await expect(
      createSite(member, { companyId: mine.id, name: "X", contractId: foreignContract.id }),
    ).rejects.toMatchObject({ fieldErrors: { contractId: [expect.any(String)] } });

    const site = await createSiteRow(db, { companyId: mine.id });
    await expect(
      updateSite(member, { id: site.id, name: "X", projectId: foreignProject.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse un domaine déjà pris par un autre client", async () => {
    const [mine, other] = [await createCompany(db), await createCompany(db)];
    await createSite(member, {
      companyId: other.id,
      name: "Autre",
      primaryDomain: "pris-ailleurs.example.fr",
    });
    await expect(
      createSite(member, {
        companyId: mine.id,
        name: "Moi",
        primaryDomain: "pris-ailleurs.example.fr",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Refusé en transaction : aucun site à moitié créé.
    const rows = await db.select().from(schema.sites).where(eq(schema.sites.companyId, mine.id));
    expect(rows).toHaveLength(0);
  });

  it("environnements distincts par type, sans doublon", async () => {
    const site = await createSiteRow(db);
    await saveEnvironment(member, {
      siteId: site.id,
      kind: "staging",
      url: "https://staging.example.fr",
      coolifyAppUuid: "app-1",
    });
    await saveEnvironment(member, {
      siteId: site.id,
      kind: "production",
      url: "https://example.fr",
      coolifyAppUuid: "app-2",
    });
    await saveEnvironment(member, {
      siteId: site.id,
      kind: "staging",
      url: "https://staging2.example.fr",
      coolifyAppUuid: "app-1",
    });
    const { environments } = await getSite(member, site.id);
    expect(environments.map((env) => env.kind).sort()).toEqual(["production", "staging"]);
    expect(environments.find((env) => env.kind === "staging")?.url).toBe(
      "https://staging2.example.fr",
    );
  });

  it("changer d'application efface l'état relu de l'ancienne", async () => {
    const site = await createSiteRow(db);
    const environment = await saveEnvironment(member, {
      siteId: site.id,
      kind: "production",
      coolifyAppUuid: "ancienne",
    });
    await db
      .update(schema.siteEnvironments)
      .set({ status: "running", statusCheckedAt: new Date() })
      .where(eq(schema.siteEnvironments.id, environment.id));

    const same = await saveEnvironment(member, {
      siteId: site.id,
      kind: "production",
      url: "https://example.fr",
      coolifyAppUuid: "ancienne",
    });
    expect(same.status).toBe("running");

    const changed = await saveEnvironment(member, {
      siteId: site.id,
      kind: "production",
      coolifyAppUuid: "nouvelle",
    });
    expect(changed.status).toBe("unknown");
    expect(changed.statusCheckedAt).toBeNull();
  });
});

describe("machine à états du site", () => {
  const paths = SITE_STATUSES.flatMap((from) =>
    SITE_STATUSES.filter((to) => to !== from).map((to) => [from, to] as [SiteStatus, SiteStatus]),
  );

  it.each(paths)("%s → %s", async (from, to) => {
    const site = await createSiteRow(db, {
      status: from,
      archivedAt: from === "archived" ? new Date() : null,
    });
    const call = changeSiteStatus(admin, { id: site.id, status: to });
    if (SITE_TRANSITIONS[from].includes(to)) {
      await expect(call).resolves.toMatchObject({ status: to });
    } else {
      await expect(call).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it("archiver pose la date, restaurer l'enlève : le site n'est jamais supprimé", async () => {
    const site = await createSiteRow(db, { status: "live" });
    const archived = await changeSiteStatus(admin, { id: site.id, status: "archived" });
    expect(archived.archivedAt).not.toBeNull();
    expect(await auditActions(site.id)).toContain("site.archived");

    const listed = await listSites(admin, { search: site.name }, page);
    expect(listed.items.map((row) => row.id)).not.toContain(site.id);
    const inArchives = await listSites(admin, { search: site.name, filter: "archived" }, page);
    expect(inArchives.items.map((row) => row.id)).toContain(site.id);

    const restored = await changeSiteStatus(admin, { id: site.id, status: "paused" });
    expect(restored.archivedAt).toBeNull();
  });

  it("archiver exige sites:archive", async () => {
    const site = await createSiteRow(db, { status: "live" });
    await expect(
      changeSiteStatus(viewer, { id: site.id, status: "archived" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("répéter une transition ne fait rien, ni audit ni événement", async () => {
    const site = await createSiteRow(db);
    await changeSiteStatus(admin, { id: site.id, status: "live" });
    await changeSiteStatus(admin, { id: site.id, status: "live" });
    const audits = await auditActions(site.id);
    expect(audits.filter((action) => action === "site.status_changed")).toHaveLength(1);
    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.entityId, site.id));
    expect(events.filter((event) => event.type === "site.live")).toHaveLength(1);
  });

  it("une remise en ligne après une pause n'émet pas un second site.live", async () => {
    const site = await createSiteRow(db);
    await changeSiteStatus(admin, { id: site.id, status: "live" });
    await changeSiteStatus(admin, { id: site.id, status: "paused" });
    await changeSiteStatus(admin, { id: site.id, status: "live" });
    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.entityId, site.id));
    expect(events.filter((event) => event.type === "site.live")).toHaveLength(1);
  });
});

describe("activateSiteAfterGoLive", () => {
  it("met en ligne, audite et émet, une seule fois", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const site = await createSiteRow(db, {
      companyId: company.id,
      projectId: project.id,
      status: "staging",
    });

    await db.transaction((tx) =>
      activateSiteAfterGoLive(member, tx, { projectId: project.id, siteId: site.id }),
    );
    await db.transaction((tx) =>
      activateSiteAfterGoLive(member, tx, { projectId: project.id, siteId: site.id }),
    );

    const { site: updated } = await getSite(member, site.id);
    expect(updated.status).toBe("live");
    expect(updated.liveOn).not.toBeNull();
    const audits = await auditActions(site.id);
    expect(audits.filter((action) => action === "site.activated")).toHaveLength(1);
    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.entityId, site.id));
    expect(events.filter((event) => event.type === "site.live")).toHaveLength(1);
  });

  it("rattache un site sans projet du même client", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const site = await createSiteRow(db, { companyId: company.id });
    await db.transaction((tx) =>
      activateSiteAfterGoLive(member, tx, { projectId: project.id, siteId: site.id }),
    );
    expect((await getSite(member, site.id)).site.projectId).toBe(project.id);
  });

  it("refuse un projet d'un autre client, ou un site rattaché à un autre projet", async () => {
    const [mine, other] = [await createCompany(db), await createCompany(db)];
    const foreign = await createProject(db, { companyId: other.id });
    const orphan = await createSiteRow(db, { companyId: mine.id });
    await expect(
      db.transaction((tx) =>
        activateSiteAfterGoLive(member, tx, { projectId: foreign.id, siteId: orphan.id }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const own = await createProject(db, { companyId: mine.id });
    const second = await createProject(db, { companyId: mine.id });
    const bound = await createSiteRow(db, { companyId: mine.id, projectId: own.id });
    await expect(
      db.transaction((tx) =>
        activateSiteAfterGoLive(member, tx, { projectId: second.id, siteId: bound.id }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse un acteur sans droit et un site archivé", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const site = await createSiteRow(db, {
      companyId: company.id,
      projectId: project.id,
      status: "archived",
      archivedAt: new Date(),
    });
    await expect(
      db.transaction((tx) =>
        activateSiteAfterGoLive(viewer, tx, { projectId: project.id, siteId: site.id }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      db.transaction((tx) =>
        activateSiteAfterGoLive(member, tx, { projectId: project.id, siteId: site.id }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("registre à l'échelle", () => {
  it("pagine, filtre et trie côté serveur sur plusieurs centaines de sites", async () => {
    const company = await createCompany(db, { name: "Client Volume" });
    await db.insert(schema.sites).values(
      Array.from({ length: 320 }, (_, index) => ({
        companyId: company.id,
        name: `Volume ${String(index).padStart(3, "0")}`,
        primaryDomain: `volume-${index}.example.fr`,
        status: index % 4 === 0 ? ("live" as const) : ("staging" as const),
        hostedByNuera: index % 2 === 0,
        cmsKind: index % 8 === 0 ? ("payload" as const) : ("none" as const),
      })),
    );

    const first = await listSites(admin, { companyId: company.id }, { page: 1, pageSize: 25 });
    expect(first.total).toBe(320);
    expect(first.items).toHaveLength(25);
    expect(first.items[0]?.name).toBe("Volume 000");

    const last = await listSites(admin, { companyId: company.id }, { page: 13, pageSize: 25 });
    expect(last.items).toHaveLength(20);

    const live = await listSites(admin, { companyId: company.id, filter: "live" }, page);
    expect(live.total).toBe(80);
    const hosted = await listSites(admin, { companyId: company.id, filter: "hosted" }, page);
    expect(hosted.total).toBe(160);
    const payload = await listSites(admin, { companyId: company.id, cmsKind: "payload" }, page);
    expect(payload.total).toBe(40);
    const search = await listSites(
      admin,
      { companyId: company.id, search: "volume-31" },
      { page: 1, pageSize: 25 },
    );
    expect(search.items.map((row) => row.primaryDomain)).toContain("volume-310.example.fr");
    const byClient = await listSites(admin, { search: "Client Volume" }, page);
    expect(byClient.total).toBe(320);

    const desc = await listSites(
      admin,
      { companyId: company.id, sort: "name", direction: "desc" },
      { page: 1, pageSize: 1 },
    );
    expect(desc.items[0]?.name).toBe("Volume 319");
  });

  it("le caractère % d'une recherche reste un caractère", async () => {
    const result = await listSites(admin, { search: "%" }, page);
    expect(result.total).toBe(0);
  });

  it("un filtre trafiqué dans l'URL est ignoré, ce n'est pas une erreur", async () => {
    await expect(
      listSites(admin, { filter: "n'importe quoi", companyId: "pas-un-uuid", sort: "x" }, page),
    ).resolves.toBeTruthy();
  });

  it("le résumé de l'en-tête est calculé", () => {
    expect(summarizeSites({ total: 0, byStatus: {} })).toBe("Aucun site enregistré");
    expect(summarizeSites({ total: 4, byStatus: { live: 3, staging: 1 } })).toBe(
      "4 sites · 3 en ligne · 1 en préproduction",
    );
  });

  it("l'aperçu ne compte pas les sites archivés", async () => {
    const before = await getSitesOverview(admin);
    await createSiteRow(db, { status: "archived", archivedAt: new Date() });
    const after = await getSitesOverview(admin);
    expect(after.total).toBe(before.total);
  });
});

describe("lectures pour les autres lots", () => {
  it("listSitesForCompany ne renvoie que ce client, en lignes compactes", async () => {
    const [mine, other] = [await createCompany(db), await createCompany(db)];
    const site = await createSiteRow(db, { companyId: mine.id, status: "live" });
    await createSiteRow(db, { companyId: other.id });
    const rows = await listSitesForCompany(viewer, mine.id, { limit: 5 });
    expect(rows.map((row) => row.id)).toEqual([site.id]);
    expect(rows[0]?.check).toBe("unverified");
  });

  it("getSitesHealthSummary : un site en ligne sans mesure n'est jamais compté en ligne", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    try {
      const now = new Date();
      await createSiteRow(own, { status: "live", name: "Sans mesure" });
      const measured = await createSiteRow(own, { status: "live", name: "Mesuré" });
      await own.insert(schema.siteUptimeSamples).values({
        siteId: measured.id,
        day: now.toISOString().slice(0, 10),
        uptimeRatio: 0.9998,
        avgResponseMs: 200,
        checkedAt: now,
      });
      await createSiteRow(own, { status: "staging" });

      const summary = await getSitesHealthSummary(own, now);
      expect(summary).toMatchObject({ total: 3, live: 2, up: 1, unverified: 1, down: 0 });
      expect(summary.rows[0]?.name).toBe("Sans mesure");
      expect(summary.lastCheckedAt).not.toBeNull();
    } finally {
      await closeOwn();
    }
  });
});

describe("santé : uniquement des échantillons réels", () => {
  it("sans mesure, tout est indisponible et les 30 jours restent inconnus", async () => {
    const site = await createSiteRow(db);
    const health = await getSiteHealth(admin, site.id);
    expect(health).toMatchObject({
      measuredDays: 0,
      uptimeRatio: null,
      avgResponseMs: null,
      serverErrors: null,
      backups: { total: 0, succeeded: 0, offSite: 0 },
    });
    expect(health.days).toHaveLength(30);
    expect(health.days.every((day) => day.state === "unknown")).toBe(true);
  });

  it("classe chaque jour et calcule sur les jours mesurés seulement", async () => {
    const site = await createSiteRow(db);
    const now = new Date("2026-11-04T12:00:00Z");
    await db.insert(schema.siteUptimeSamples).values([
      { siteId: site.id, day: "2026-11-04", uptimeRatio: 1, avgResponseMs: 200, checkedAt: now },
      { siteId: site.id, day: "2026-11-03", uptimeRatio: 0.9, avgResponseMs: 400, checkedAt: now },
      {
        siteId: site.id,
        day: "2026-11-02",
        uptimeRatio: 1,
        avgResponseMs: 1500,
        serverErrors: 3,
        checkedAt: now,
      },
    ]);
    const health = await getSiteHealth(admin, site.id, now);
    expect(health.measuredDays).toBe(3);
    expect(health.uptimeRatio).toBeCloseTo((1 + 0.9 + 1) / 3);
    expect(health.avgResponseMs).toBe(700);
    expect(health.serverErrors).toBe(3);
    const byDay = new Map(health.days.map((day) => [day.day, day.state]));
    expect(byDay.get("2026-11-04")).toBe("up");
    expect(byDay.get("2026-11-03")).toBe("down");
    expect(byDay.get("2026-11-02")).toBe("slow");
    expect(byDay.get("2026-11-01")).toBe("unknown");
  });
});

describe("jamais de vert sans donnée", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const fresh = new Date(now.getTime() - 60_000);
  const old = new Date(now.getTime() - 7 * 86_400_000);
  const base = {
    status: "live" as const,
    isDown: false,
    productionStatus: null,
    productionCheckedAt: null,
    lastSampleAt: null,
  };

  it("site en ligne", () => {
    expect(siteHealthBadge(base, now)).toEqual({
      label: "En ligne · non vérifié",
      tone: "neutral",
    });
    expect(siteHealthBadge({ ...base, lastSampleAt: old }, now).tone).toBe("neutral");
    expect(siteHealthBadge({ ...base, lastSampleAt: fresh }, now).tone).toBe("success");
    expect(
      siteHealthBadge({ ...base, productionStatus: "running", productionCheckedAt: fresh }, now)
        .tone,
    ).toBe("success");
    expect(
      siteHealthBadge({ ...base, productionStatus: "running", productionCheckedAt: old }, now).tone,
    ).toBe("neutral");
    expect(siteHealthBadge({ ...base, isDown: true, lastSampleAt: fresh }, now)).toEqual({
      label: "Hors ligne",
      tone: "danger",
    });
    expect(liveCheck({ ...base, productionStatus: "error", productionCheckedAt: fresh }, now)).toBe(
      "down",
    );
  });

  it("environnement", () => {
    const env = { kind: "production" as const, status: "running" as const };
    expect(environmentBadge({ ...env, statusCheckedAt: null }, now)).toEqual({
      label: "Production · indisponible",
      tone: "neutral",
    });
    expect(environmentBadge({ ...env, statusCheckedAt: fresh }, now)).toEqual({
      label: "Production · opérationnel",
      tone: "success",
    });
    expect(environmentBadge({ ...env, statusCheckedAt: old }, now).tone).toBe("neutral");
  });

  it("certificat", () => {
    const domain = { tlsStatus: "valid" as const, tlsExpiresOn: "2027-01-01" };
    expect(tlsBadge({ ...domain, checkedAt: null }, now).tone).toBe("neutral");
    expect(tlsBadge({ ...domain, checkedAt: fresh }, now).tone).toBe("success");
    expect(
      tlsBadge({ ...domain, checkedAt: old.getTime() ? new Date("2026-01-01") : old }, now).tone,
    ).toBe("neutral");
    expect(tlsBadge({ ...domain, tlsStatus: "expired", checkedAt: fresh }, now).tone).toBe(
      "danger",
    );
    expect(tlsBadge({ ...domain, tlsStatus: "expiring", checkedAt: fresh }, now).tone).toBe("warn");
  });
});
