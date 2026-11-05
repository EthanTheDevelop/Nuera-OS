import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import type { TileView } from "@/modules/dashboard/dashboard.types";
import {
  buildBuckets,
  deltaPercent,
  monthsIn,
  resolvePeriod,
} from "@/modules/dashboard/reporting.periods";
import { exportReportingCsv, getReporting } from "@/modules/dashboard/reporting.service";
import { getMargin } from "@/modules/finance/profitability.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createOpportunity,
  createProject,
  createQuote,
  createTeamMember,
} from "../../helpers/factories";

const NOW = new Date("2026-11-15T11:00:00Z");

function ready<T>(section: { status: "ready"; data: T } | { status: "error" } | undefined): T {
  if (section?.status !== "ready") throw new Error("Section non prête");
  return section.data;
}

describe("périodes", () => {
  it("nomme la période et la précédente, au calendrier", () => {
    expect(resolvePeriod("mois", "2026-11-15")).toMatchObject({
      range: { from: "2026-11-01", to: "2026-11-30" },
      previous: { from: "2026-10-01", to: "2026-10-31" },
      label: "Novembre 2026",
      previousLabel: "octobre",
    });
    expect(resolvePeriod("mois-dernier", "2026-01-31")).toMatchObject({
      range: { from: "2025-12-01", to: "2025-12-31" },
      previous: { from: "2025-11-01", to: "2025-11-30" },
    });
    expect(resolvePeriod("trimestre", "2026-11-15")).toMatchObject({
      range: { from: "2026-10-01", to: "2026-12-31" },
      previous: { from: "2026-07-01", to: "2026-09-30" },
      label: "T4 2026",
    });
    expect(resolvePeriod("annee-derniere", "2026-11-15")).toMatchObject({
      range: { from: "2025-01-01", to: "2025-12-31" },
      label: "2025",
      previousLabel: "2024",
    });
  });

  it("découpe mois, trimestres et années, la case courante en dernier", () => {
    const months = buildBuckets("mois", "2026-11-15");
    expect(months.map((bucket) => bucket.label)).toEqual([
      "Juin",
      "Juil.",
      "Août",
      "Sept.",
      "Oct.",
      "Nov.",
    ]);
    const quarters = buildBuckets("trimestre", "2026-11-15");
    expect(quarters.map((bucket) => bucket.key)).toEqual([
      "2026-T1",
      "2026-T2",
      "2026-T3",
      "2026-T4",
    ]);
    expect(quarters[3]?.range).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(buildBuckets("annee", "2026-11-15").map((bucket) => bucket.key)).toEqual([
      "2024",
      "2025",
      "2026",
    ]);
    expect(monthsIn({ from: "2026-10-01", to: "2026-12-31" })).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
  });

  it("n'invente pas d'écart sans base de comparaison", () => {
    expect(deltaPercent(100, 0)).toBeNull();
    expect(deltaPercent(110, 100)).toBe(10);
    expect(deltaPercent(0, 100)).toBe(-100);
  });
});

describe("reporting", () => {
  let db: Database;
  let close: () => Promise<void>;
  let admin: ServiceContext;
  let member: ServiceContext;
  let viewer: ServiceContext;
  let companyId: string;
  let projectId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    admin = await createTestContext(db, "admin");
    member = await createTestContext(db, "member");
    viewer = await createTestContext(db, "viewer");
    const company = await createCompany(db, { status: "client" });
    companyId = company.id;
    const project = await createProject(db, {
      companyId,
      activity: "vitrine",
      status: "active",
      estimatedMinutes: 6000,
    });
    projectId = project.id;
    const contract = await createContract(db, {
      companyId,
      kind: "hosting",
      status: "active",
      priceCents: 4900,
      period: "monthly",
      startOn: "2026-10-01",
    });
    const person = await createTeamMember(db, { kind: "partner", status: "active" });
    await db.insert(schema.financialDocuments).values([
      {
        companyId,
        projectId,
        source: "manual",
        externalRef: "F-1",
        issuedOn: "2026-11-02",
        amountCents: 100_000,
      },
      {
        companyId,
        contractId: contract.id,
        source: "manual",
        externalRef: "F-2",
        issuedOn: "2026-11-03",
        amountCents: 4900,
      },
      {
        companyId,
        projectId,
        source: "manual",
        externalRef: "F-3",
        issuedOn: "2026-10-15",
        amountCents: 50_000,
      },
      {
        companyId,
        projectId,
        source: "manual",
        externalRef: "F-4",
        issuedOn: "2025-11-15",
        amountCents: 20_000,
      },
    ]);
    await db.insert(schema.timeEntries).values({
      memberId: person.id,
      companyId,
      projectId,
      workOn: "2026-11-04",
      minutes: 600,
      category: "production",
      hourlyCostCents: 6000,
    });
    // Gagnée le 31 octobre à 23 h 30 UTC : déjà novembre à Paris.
    await createOpportunity(db, {
      stage: "WON",
      amountCents: 1000,
      wonAt: new Date("2026-10-31T23:30:00Z"),
    });
    await createOpportunity(db, {
      stage: "LOST",
      lostReason: '=HYPERLINK("http://evil.test","Budget")',
      lostAt: new Date("2026-11-10T10:00:00Z"),
    });
    await createOpportunity(db, {
      stage: "LOST",
      lostReason: "Délai",
      lostAt: new Date("2026-10-10T10:00:00Z"),
    });
    const open = await createOpportunity(db, {
      stage: "NEGOTIATION",
      amountCents: 200_000,
      probability: 25,
    });
    await createQuote(
      db,
      {
        companyId: open.companyId ?? undefined,
        opportunityId: open.id,
        status: "negotiation",
        sentAt: new Date("2026-11-01T09:00:00Z"),
      },
      { totalCents: 200_000 },
    );
    const noQuote = await createOpportunity(db, { stage: "QUALIFIED", amountCents: 70_000 });
    expect(noQuote.id).toBeTruthy();
    await db.insert(schema.paymentScheduleItems).values({
      companyId,
      projectId,
      label: "Solde",
      dueOn: "2026-12-15",
      amountCents: 30_000,
      status: "planned",
    });
  });
  afterAll(() => close());

  it("compare à la période précédente et au même mois de l'année d'avant", async () => {
    const data = await getReporting(admin, {}, NOW);
    expect(data.label).toBe("Novembre 2026");
    expect(data.previousLabel).toBe("octobre");
    const revenue = ready(data.revenue);
    expect(revenue.totalCents).toBe(104_900);
    expect(revenue.previousCents).toBe(50_000);
    expect(revenue.deltaPercent).toBe(110);
    expect(revenue.current).toHaveLength(6);
    expect(revenue.current.at(-1)).toBe(1049);
    expect(revenue.previous.at(-1)).toBe(200);
    expect(revenue.currentLabel).toBe("2026");
  });

  it("change de période et de découpage, une valeur d'URL inconnue retombe sur le défaut", async () => {
    const october = await getReporting(admin, { periode: "mois-dernier" }, NOW);
    expect(ready(october.revenue).totalCents).toBe(50_000);
    expect(ready(october.sales).lost).toBe(1);

    const year = await getReporting(admin, { periode: "annee", granularite: "annee" }, NOW);
    expect(ready(year.revenue).totalCents).toBe(154_900);
    expect(ready(year.revenue).points.map((point) => point.label)).toEqual([
      "2024",
      "2025",
      "2026",
    ]);

    const odd = await getReporting(admin, { periode: "n'importe", granularite: "quoi" }, NOW);
    expect(odd.periodKey).toBe("mois");
    expect(odd.granularity).toBe("mois");
  });

  it("calcule la conversion au calendrier de Paris", async () => {
    const data = await getReporting(admin, {}, NOW);
    const sales = ready(data.sales);
    expect(sales.won).toBe(1);
    expect(sales.lost).toBe(1);
    expect(sales.conversionPercent).toBe(50);
    expect(ready(data.conversion).wonSeries.at(-1)).toBe(1);
    expect(ready(data.conversion).wonSeries.at(-2)).toBe(0);
    expect(ready(data.conversion).lostSeries.at(-2)).toBe(1);
  });

  it("la marge est celle de getMargin, le tableau par activité aussi (A3)", async () => {
    const range = { from: "2026-11-01", to: "2026-11-30" };
    const client = await getMargin(db, { scope: "client", id: companyId, period: range }, NOW);
    const project = await getMargin(db, { scope: "project", id: projectId, period: range }, NOW);
    const data = await getReporting(admin, {}, NOW);

    expect(ready(data.margin).percent).toBeCloseTo(client.actual.marginPercent ?? 0, 5);
    const vitrine = ready(data.activities).find((row) => row.activity === "vitrine");
    expect(vitrine?.revenueCents).toBe(project.actual.revenueCents);
    expect(vitrine?.minutes).toBe(600);
    expect(vitrine?.marginPercent).toBeCloseTo(project.actual.marginPercent ?? 0, 5);
    const hosting = ready(data.activities).find((row) => row.activity === "hebergement");
    expect(hosting?.revenue).toContain("/mois");
    expect(ready(data.activities).reduce((total, row) => total + row.share, 0)).toBe(100);
  });

  it("même chiffre d'affaires et même MRR sur le tableau de bord et le reporting (A3)", async () => {
    const [report, board] = await Promise.all([
      getReporting(admin, {}, NOW),
      getDashboard(admin, { now: NOW }),
    ]);
    const view = (key: "revenue" | "mrr"): TileView => {
      const state = board.tiles[key];
      if (state?.status !== "ready") throw new Error(key);
      return state.view;
    };
    expect(view("revenue").figure).toMatchObject({
      value: ready(report.revenue).totalCents / 100,
    });
    expect(view("mrr").figure).toMatchObject({ value: ready(report.recurring).mrrCents / 100 });
  });

  it("filtre par activité", async () => {
    const data = await getReporting(admin, { activite: "vitrine" }, NOW);
    expect(data.activity).toBe("vitrine");
    expect(ready(data.revenue).totalCents).toBe(100_000);
    expect(ready(data.revenue).previousCents).toBe(50_000);
    expect(ready(data.activities).map((row) => row.activity)).toEqual(["vitrine"]);
  });

  it("la prévision sépare certain, probable et hypothétique, sans double compte", async () => {
    const forecast = ready((await getReporting(admin, {}, NOW)).forecast);
    expect(forecast.certainCents).toBe(30_000);
    expect(forecast.probableCents).toBe(50_000);
    expect(forecast.probableCount).toBe(1);
    // L'affaire qui a un devis en cours n'est pas recomptée dans le pipeline.
    expect(forecast.hypotheticalCents).toBe(70_000);
  });

  it("sans finance:read, rien de financier n'est lu", async () => {
    for (const ctx of [member, viewer]) {
      const data = await getReporting(ctx, { activite: "vitrine" }, NOW);
      expect(data.canSeeFinance).toBe(false);
      expect(data.canExport).toBe(false);
      expect(data.activity).toBeNull();
      for (const section of [data.revenue, data.recurring, data.margin, data.activities]) {
        expect(section).toBeUndefined();
      }
      expect(data.forecast).toBeUndefined();
      expect(ready(data.conversion).won).toBe(1);
    }
    await expect(
      getReporting(await createTestContext(db, "contractor"), {}, NOW),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("une section qui échoue reste seule en erreur", async () => {
    const fresh = await createTestDatabase();
    try {
      const ctx = await createTestContext(fresh.db, "admin");
      await fresh.client.exec("alter table direct_costs rename to direct_costs_hs");
      const data = await getReporting(ctx, {}, NOW);
      expect(data.margin?.status).toBe("error");
      expect(data.revenue?.status).toBe("ready");
      expect(data.sales?.status).toBe("ready");
    } finally {
      await fresh.close();
    }
  });

  it("une base vide donne de vrais zéros et des marges non calculables", async () => {
    const fresh = await createTestDatabase();
    try {
      const ctx = await createTestContext(fresh.db, "admin");
      const data = await getReporting(ctx, {}, NOW);
      expect(ready(data.revenue).totalCents).toBe(0);
      expect(ready(data.revenue).deltaPercent).toBeNull();
      expect(ready(data.margin).percent).toBeNull();
      expect(ready(data.conversion).percent).toBeNull();
      expect(ready(data.activities)).toEqual([]);
    } finally {
      await fresh.close();
    }
  });

  describe("export", () => {
    it("réservé à export:run et finance:read", async () => {
      await expect(exportReportingCsv(member)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(exportReportingCsv(viewer)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        exportReportingCsv(await createTestContext(db, "contractor")),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("mêmes chiffres que l'écran, formule neutralisée, journalisé", async () => {
      const { csv, filename, rows } = await exportReportingCsv(admin, {}, NOW);
      expect(filename).toBe("nuera-reporting-mois-2026-11-15.csv");
      expect(rows).toBeGreaterThan(10);
      expect(csv.startsWith("﻿Section;Indicateur;Valeur")).toBe(true);
      expect(csv).toContain("Facturé HT;1049,00;€;500,00");
      expect(csv).toContain("MRR;49,00");
      // Une raison de perte saisie ne doit jamais s'exécuter dans un tableur.
      expect(csv).toMatch(/Raison de perte;"?'=HYPERLINK/);
      expect(csv).not.toMatch(/Raison de perte;"?=HYPERLINK/);

      const [audit] = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.actorId, admin.actor.userId),
            eq(schema.auditLog.action, "export.run"),
          ),
        )
        .orderBy(desc(schema.auditLog.occurredAt))
        .limit(1);
      expect(audit?.metadata).toMatchObject({ module: "reporting", period: "mois" });
    });
  });
});
