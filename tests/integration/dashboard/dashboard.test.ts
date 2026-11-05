import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  TILE_CATALOG,
  closestInsertion,
  emptyCells,
  moveTile,
  packTiles,
  nearestTileSize,
  stepTileSize,
  tileSpan,
} from "@/modules/dashboard/dashboard.tiles";
import {
  getDashboard,
  getDashboardLayout,
  isEntryNavigation,
  isSafeHomePath,
  resolveHomeRedirect,
  saveDashboardLayout,
} from "@/modules/dashboard/dashboard.service";
import type { TileView } from "@/modules/dashboard/dashboard.types";
import { getFinanceSummary } from "@/modules/finance/finance.service";
import { getMargin } from "@/modules/finance/profitability.service";
import type * as automationModule from "@/modules/platform/automation.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, ServiceUnavailableError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createOpportunity,
  createProject,
  createQuote,
} from "../../helpers/factories";

const automations = vi.hoisted(() => ({ fail: false }));

vi.mock("@/modules/platform/automation.service", async (original) => {
  const actual = await original<typeof automationModule>();
  return {
    ...actual,
    getAutomationsSummary: async (...args: Parameters<typeof actual.getAutomationsSummary>) => {
      if (automations.fail) throw new ServiceUnavailableError("n8n", "not_configured", "absent");
      return actual.getAutomationsSummary(...args);
    },
  };
});

/** 15 novembre 2026, midi à Paris. */
const NOW = new Date("2026-11-15T11:00:00Z");

function readyView(state: { status: string } | undefined): TileView {
  if (state?.status !== "ready") throw new Error(`Tuile non prête : ${state?.status}`);
  return (state as unknown as { view: TileView }).view;
}

describe("disposition du tableau de bord", () => {
  let db: Database;
  let client: Awaited<ReturnType<typeof createTestDatabase>>["client"];
  let close: () => Promise<void>;
  let admin: ServiceContext;
  let member: ServiceContext;
  let viewer: ServiceContext;
  let contractor: ServiceContext;

  beforeAll(async () => {
    ({ db, client, close } = await createTestDatabase());
    admin = await createTestContext(db, "admin");
    member = await createTestContext(db, "member");
    viewer = await createTestContext(db, "viewer");
    contractor = await createTestContext(db, "contractor");
  });
  afterAll(() => close());

  it("le tableau d'un nouveau compte suit son rôle : aucune tuile financière sans finance:read", async () => {
    const adminTiles = (await getDashboardLayout(admin)).tiles.map((tile) => tile.key);
    const memberTiles = (await getDashboardLayout(member)).tiles.map((tile) => tile.key);
    const viewerTiles = (await getDashboardLayout(viewer)).tiles.map((tile) => tile.key);

    expect(adminTiles).toEqual(
      expect.arrayContaining(["revenue", "pipeline", "mrr", "collected", "shared_costs"]),
    );
    for (const tiles of [memberTiles, viewerTiles]) {
      expect(tiles).not.toContain("revenue");
      expect(tiles).not.toContain("mrr");
      expect(tiles).not.toContain("collected");
      expect(tiles).not.toContain("shared_costs");
      expect(tiles).toContain("pipeline");
    }
    const data = await getDashboard(viewer, { now: NOW, editing: true });
    expect(Object.keys(data.tiles)).not.toContain("revenue");
    expect(data.gallery.map((tile) => tile.key)).not.toContain("invoices");
    expect(data.gallery.map((tile) => tile.key)).not.toContain("automations");
  });

  it("un prestataire n'a pas de tableau de bord", async () => {
    await expect(getDashboard(contractor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getDashboardLayout(contractor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveDashboardLayout(contractor, { tiles: [] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("enregistre par compte, et le serveur valide", async () => {
    const layout = {
      tiles: [
        { key: "pipeline", size: "1x1" },
        { key: "support", size: "2x2" },
      ],
    };
    await saveDashboardLayout(member, layout);
    expect((await getDashboardLayout(member)).tiles).toEqual(layout.tiles);
    // Un autre compte garde le sien.
    expect((await getDashboardLayout(viewer)).tiles.length).toBeGreaterThan(2);

    const refused = [
      { tiles: [{ key: "inconnue", size: "1x1" }] },
      { tiles: [{ key: "pipeline", size: "9x9" }] },
      { tiles: [{ key: "pipeline", size: "4x2" }] },
      {
        tiles: [
          { key: "pipeline", size: "1x1" },
          { key: "pipeline", size: "2x1" },
        ],
      },
      { tiles: "tout" },
    ];
    for (const input of refused) {
      await expect(saveDashboardLayout(member, input)).rejects.toBeInstanceOf(ValidationError);
    }
    // Une tuile financière ne s'ajoute pas en forgeant la requête.
    await expect(
      saveDashboardLayout(member, { tiles: [{ key: "revenue", size: "4x2" }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await getDashboardLayout(member)).tiles).toEqual(layout.tiles);
  });

  it("rejouer la même disposition n'écrit rien et ne trace rien de plus", async () => {
    const layout = { tiles: [{ key: "support", size: "1x1" }] };
    const audits = async () => {
      const [row] = await db
        .select({ total: count() })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.actorId, viewer.actor.userId),
            eq(schema.auditLog.action, "user_preference.updated"),
          ),
        );
      return row?.total ?? 0;
    };
    await saveDashboardLayout(viewer, layout);
    const after = await audits();
    expect(after).toBe(1);
    await saveDashboardLayout(viewer, layout);
    expect(await audits()).toBe(after);
  });

  it("une disposition enregistrée illisible ou d'un autre rôle ne casse rien", async () => {
    const ctx = await createTestContext(db, "viewer");
    await db.insert(schema.userPreferences).values({
      userId: ctx.actor.userId,
      dashboardLayout: { tiles: [{ key: "n_existe_plus", size: "1x1" }] },
    });
    expect((await getDashboardLayout(ctx)).tiles.length).toBeGreaterThan(0);

    await db
      .update(schema.userPreferences)
      .set({
        dashboardLayout: {
          tiles: [
            { key: "revenue", size: "4x2" },
            { key: "support", size: "1x1" },
          ],
        },
      })
      .where(eq(schema.userPreferences.userId, ctx.actor.userId));
    expect((await getDashboardLayout(ctx)).tiles).toEqual([{ key: "support", size: "1x1" }]);
  });

  it("les flèches changent de format sans boucler, le glisser se cale sur le format le plus proche", () => {
    expect(stepTileSize("pipeline", "1x1", 1)).toBe("2x1");
    expect(stepTileSize("pipeline", "2x2", 1)).toBe("2x2");
    expect(stepTileSize("pipeline", "1x1", -1)).toBe("1x1");
    expect(stepTileSize("revenue", "2x2", 1)).toBe("4x2");
    expect(stepTileSize("revenue", "4x2", -1)).toBe("2x2");

    // Sans déplacement, le format reste, même quand il est borné par la grille.
    expect(nearestTileSize("revenue", "2x1", { columns: 2, rows: 1 }, 6)).toBe("2x1");
    expect(nearestTileSize("revenue", "4x2", { columns: 2, rows: 2 }, 2)).toBe("4x2");
    expect(nearestTileSize("pipeline", "1x1", { columns: 1.4, rows: 1 }, 6)).toBe("1x1");
    expect(nearestTileSize("pipeline", "1x1", { columns: 1.6, rows: 1 }, 6)).toBe("2x1");
    expect(nearestTileSize("pipeline", "1x1", { columns: 2, rows: 1.8 }, 6)).toBe("2x2");
    // Un format que la tuile n'a pas n'est jamais choisi.
    expect(nearestTileSize("pipeline", "2x2", { columns: 4, rows: 2 }, 6)).toBe("2x2");
    expect(nearestTileSize("revenue", "2x2", { columns: 3.6, rows: 2 }, 6)).toBe("4x2");
    expect(tileSpan("4x2", 2)).toEqual({ columns: 2, rows: 2 });

    // Placement dense : le 1×1 passe sous le 2×1, dans le trou à droite du 4×2.
    const board = [
      { key: "revenue", size: "4x2" },
      { key: "load", size: "2x1" },
      { key: "mrr", size: "1x1" },
    ] as const;
    const packed = packTiles(board, 6);
    expect(packed.get("load")).toMatchObject({ column: 5, row: 1 });
    expect(packed.get("mrr")).toMatchObject({ column: 5, row: 2 });
    // Le trou de la deuxième rangée, puis la rangée en réserve.
    expect(emptyCells(packed, 6)).toEqual([
      { column: 6, row: 2 },
      ...[1, 2, 3, 4, 5, 6].map((column) => ({ column, row: 3 })),
    ]);
    // Visée de la case libre : la tuile s'y pose au dernier rang. En haut à gauche : premier rang.
    const others = board.slice(0, 2);
    expect(closestInsertion(others, board[2], { column: 5, row: 2 }, 6, 2)).toBe(2);
    expect(closestInsertion(others, board[2], { column: 1, row: 1 }, 6, 2)).toBe(0);

    const tiles = [
      { key: "pipeline", size: "1x1" },
      { key: "support", size: "1x1" },
    ] as const;
    expect(moveTile(tiles, "pipeline", 9).map((tile) => tile.key)).toEqual(["support", "pipeline"]);
    expect(moveTile(tiles, "support", -3).map((tile) => tile.key)).toEqual(["support", "pipeline"]);
  });

  it("sur une base vide : de vrais états vides, aucune tuile en erreur", async () => {
    const fresh = await createTestDatabase();
    try {
      const ctx = await createTestContext(fresh.db, "admin");
      const { tiles } = await getDashboard(ctx, { editing: true, now: NOW });
      const keys = TILE_CATALOG.map((definition) => definition.key);
      for (const key of keys) expect(tiles[key]?.status, key).toBe("ready");
      for (const key of ["revenue", "pipeline", "messages", "quotes", "sites"] as const) {
        expect(readyView(tiles[key]).empty, key).toBeDefined();
      }
      expect(readyView(tiles.collected).figure).toEqual({ kind: "euros", value: 0 });
    } finally {
      await fresh.close();
    }
  });

  it("une tuile qui échoue reste seule en erreur", async () => {
    await client.exec("alter table appointments rename to appointments_hs");
    try {
      const { tiles } = await getDashboard(admin, { now: NOW });
      expect(tiles.appointments?.status).toBe("error");
      expect(tiles.pipeline?.status).toBe("ready");
      expect(tiles.revenue?.status).toBe("ready");
      expect(tiles.support?.status).toBe("ready");
    } finally {
      await client.exec("alter table appointments_hs rename to appointments");
    }
  });

  it("une intégration absente : état de connexion, jamais de succès simulé", async () => {
    automations.fail = true;
    try {
      const { tiles } = await getDashboard(admin, { now: NOW, editing: true });
      expect(tiles.automations?.status).toBe("unavailable");
      expect(tiles.pipeline?.status).toBe("ready");
    } finally {
      automations.fail = false;
    }
    const { tiles } = await getDashboard(admin, { now: NOW, editing: true });
    expect(tiles.automations?.status).toBe("ready");
  });
});

describe("page d'accueil", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(() => close());

  const setHome = (userId: string, homePath: string | null) =>
    db
      .insert(schema.userPreferences)
      .values({ userId, homePath })
      .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { homePath } });

  it("mène un prestataire vers une page qu'il peut ouvrir", async () => {
    const contractor = await createTestContext(db, "contractor");
    expect(await resolveHomeRedirect(contractor, { referer: null })).toBe("/projets");
    // Même depuis un clic interne : il n'a pas de tableau de bord.
    expect(await resolveHomeRedirect(contractor, { referer: "http://localhost/temps" })).toBe(
      "/projets",
    );

    await setHome(contractor.actor.userId, "/temps");
    expect(await resolveHomeRedirect(contractor, { referer: null })).toBe("/temps");

    // Sa préférence ne l'envoie jamais vers une page refusée.
    await setHome(contractor.actor.userId, "/finances");
    expect(await resolveHomeRedirect(contractor, { referer: null })).toBe("/projets");
    await setHome(contractor.actor.userId, "/");
    expect(await resolveHomeRedirect(contractor, { referer: null })).toBe("/projets");
  });

  it("suit la préférence à l'arrivée seulement, le tableau de bord reste accessible", async () => {
    const viewer = await createTestContext(db, "viewer");
    expect(await resolveHomeRedirect(viewer, { referer: null })).toBeNull();

    await setHome(viewer.actor.userId, "/pipeline");
    expect(await resolveHomeRedirect(viewer, { referer: null })).toBe("/pipeline");
    expect(await resolveHomeRedirect(viewer, { referer: "http://localhost/login?next=%2F" })).toBe(
      "/pipeline",
    );
    expect(await resolveHomeRedirect(viewer, { referer: "http://localhost/pipeline" })).toBeNull();

    await setHome(viewer.actor.userId, "/finances");
    expect(await resolveHomeRedirect(viewer, { referer: null })).toBeNull();
  });

  it("refuse une adresse externe ou l'espace client", async () => {
    for (const path of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/espace",
      "/api/x",
      "",
    ]) {
      expect(isSafeHomePath(path), path).toBe(false);
    }
    expect(isSafeHomePath("/pipeline")).toBe(true);
    expect(isSafeHomePath(null)).toBe(false);
    const viewer = await createTestContext(db, "viewer");
    await setHome(viewer.actor.userId, "//evil.test");
    expect(await resolveHomeRedirect(viewer, { referer: null })).toBeNull();
    expect(isEntryNavigation("pas une adresse")).toBe(true);
  });
});

describe("chiffres des tuiles", () => {
  let db: Database;
  let close: () => Promise<void>;
  let admin: ServiceContext;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    admin = await createTestContext(db, "admin");
    const company = await createCompany(db, { status: "client" });
    const project = await createProject(db, {
      companyId: company.id,
      activity: "vitrine",
      status: "active",
    });
    const contract = await createContract(db, {
      companyId: company.id,
      kind: "hosting",
      status: "active",
      priceCents: 4900,
      period: "monthly",
      startOn: "2026-01-01",
    });
    await db.insert(schema.financialDocuments).values([
      {
        companyId: company.id,
        projectId: project.id,
        source: "manual",
        externalRef: "NOV-1",
        issuedOn: "2026-11-02",
        dueOn: "2026-12-02",
        amountCents: 100_000,
      },
      {
        companyId: company.id,
        contractId: contract.id,
        source: "manual",
        externalRef: "NOV-2",
        issuedOn: "2026-11-03",
        dueOn: "2026-12-03",
        amountCents: 4900,
        status: "paid",
        paidOn: "2026-11-04",
      },
      {
        companyId: company.id,
        projectId: project.id,
        kind: "credit_note",
        source: "manual",
        externalRef: "NOV-A",
        issuedOn: "2026-11-05",
        amountCents: -10_000,
      },
      {
        companyId: company.id,
        projectId: project.id,
        source: "manual",
        externalRef: "NOV-X",
        issuedOn: "2026-11-06",
        amountCents: 999_999,
        status: "cancelled",
      },
      {
        companyId: company.id,
        projectId: project.id,
        source: "manual",
        externalRef: "OCT-1",
        issuedOn: "2026-10-10",
        dueOn: "2026-11-10",
        amountCents: 50_000,
        status: "paid",
        paidOn: "2026-10-20",
      },
    ]);
    await createOpportunity(db, { stage: "NEW", amountCents: 12_000 });
    const opportunity = await createOpportunity(db, {
      stage: "QUOTE_SENT",
      amountCents: 80_000,
      probability: 50,
    });
    await createQuote(
      db,
      {
        companyId: opportunity.companyId ?? undefined,
        opportunityId: opportunity.id,
        status: "sent",
        sentAt: new Date("2026-11-05T09:00:00Z"),
      },
      { totalCents: 80_000 },
    );
  });
  afterAll(() => close());

  it("le chiffre d'affaires est le facturé des Finances, avoirs déduits, annulées exclues", async () => {
    const { tiles } = await getDashboard(admin, { now: NOW });
    const revenue = readyView(tiles.revenue);
    const summary = await getFinanceSummary(db, { from: "2026-11-01", to: "2026-11-30" }, NOW);
    expect(summary.invoicedCents).toBe(94_900);
    expect(revenue.figure).toMatchObject({ kind: "euros", value: 949 });
    expect(revenue.chart?.projects.at(-1)).toBe(900);
    expect(revenue.chart?.recurring.at(-1)).toBe(49);
    expect(revenue.chart?.points).toHaveLength(6);
    expect(revenue.badge?.label).toContain("vs octobre");
    expect(revenue.badge?.label).toBe("+90 % vs octobre");
  });

  it("MRR, encaissé et pipeline viennent de leur module", async () => {
    const { tiles } = await getDashboard(admin, { now: NOW });
    expect(readyView(tiles.mrr).figure).toMatchObject({ value: 49 });
    expect(readyView(tiles.collected).figure).toMatchObject({ value: 49 });
    const pipeline = readyView(tiles.pipeline);
    expect(pipeline.badge?.label).toBe("2 affaires");
    expect(pipeline.rows?.find((row) => row.id === "NEW")?.value).toContain("120");
    const quotes = readyView(tiles.quotes);
    expect(quotes.figure).toMatchObject({ value: 1 });
    expect(quotes.rows?.[0]?.badge?.label).toBe("Relance J+10");
  });

  it("le rapport mensuel prend sa marge à la source unique", async () => {
    const { tiles } = await getDashboard(admin, { now: NOW, editing: true });
    const report = readyView(tiles.monthly_report);
    expect(report.figure).toMatchObject({ value: 500 });
    const [company] = await db.select({ id: schema.companies.id }).from(schema.companies).limit(1);
    if (!company) throw new Error("Client absent");
    const margin = await getMargin(
      db,
      { scope: "client", id: company.id, period: { from: "2026-10-01", to: "2026-10-31" } },
      NOW,
    );
    expect(margin.actual.marginPercent).toBe(100);
    expect(report.rows?.find((row) => row.id === "margin")?.value).toBe("100 %");
  });
});
