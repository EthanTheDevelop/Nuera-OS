import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changeContractStatus,
  createContract,
  getContractRecord,
  linkContractSite,
} from "@/modules/contracts/contract.service";
import { formatNumber } from "@/lib/format";
import { loadCompanyRelated } from "@/modules/crm/company.related";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import { getPeriodMargin } from "@/modules/dashboard/metrics.service";
import { getReporting } from "@/modules/dashboard/reporting.service";
import { exportFinanceCsv } from "@/modules/finance/finance.export";
import { createDirectCost, createInvoiceReference } from "@/modules/finance/finance.service";
import {
  getMargin,
  getMarginForActor,
  getProfitabilityOverview,
  listProfitability,
} from "@/modules/finance/profitability.service";
import { changeProjectStatus, getProjectDetail } from "@/modules/projects/project.service";
import { createSite } from "@/modules/sites/site.service";
import { createTimeEntry } from "@/modules/time/time.service";
import type { ServiceContext } from "@/server/context";
import type * as s from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { createMemberContext } from "../helpers/factories";
import { createJourneyWorld, sellProject, type JourneyWorld } from "./world";

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
/** Le rapport mensuel du tableau de bord lit le mois précédent : on se place le mois suivant. */
const NEXT_MONTH = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 15, 10));
const ONE_PAGE = { page: 1, pageSize: 25 };

/** Facturé, moins un avoir ; temps à 60 €/h ; un coût réel ; un prévisionnel qui n'y entre jamais. */
const PROJECT = { revenue: 480_000, time: 9_000, direct: 30_000, cost: 39_000, margin: 441_000 };
const CONTRACT = { revenue: 9_900, time: 3_000, direct: 1_000, cost: 4_000, margin: 5_900 };
const CLIENT = { revenue: 489_900, time: 12_000, direct: 31_000, cost: 43_000, margin: 446_900 };
const OTHER = { revenue: 100_000, margin: 100_000 };
const AGENCY_MARGIN = CLIENT.margin + OTHER.margin;
const AGENCY_REVENUE = CLIENT.revenue + OTHER.revenue;

describe("parcours 4 : temps, coûts et montants HT → la même marge partout", () => {
  let world: JourneyWorld;
  let worker: ServiceContext;
  let company: s.Company;
  let project: s.Project;
  let contract: s.Contract;

  beforeAll(async () => {
    world = await createJourneyWorld();
    const { admin, member, db } = world;
    worker = await createMemberContext(db, "member", { hourlyCostCents: 6_000 });
    const sold = await sellProject(world, "Client Marge");
    company = sold.company;
    project = sold.project;
    await changeProjectStatus(member, { projectId: project.id, status: "active" });

    const issuerMemberId = (admin as unknown as { member: s.TeamMember }).member.id;
    const invoice = {
      companyId: company.id,
      issuerMemberId,
      issuedOn: TODAY,
    };
    await createInvoiceReference(admin, {
      ...invoice,
      projectId: project.id,
      externalRef: "MARGE-1",
      amountCents: 500_000,
    });
    await createInvoiceReference(admin, {
      ...invoice,
      projectId: project.id,
      kind: "credit_note",
      externalRef: "MARGE-AVOIR",
      amountCents: 20_000,
    });
    await createDirectCost(admin, {
      companyId: company.id,
      projectId: project.id,
      label: "Sous-traitance",
      category: "subcontracting",
      amountCents: 30_000,
      incurredOn: TODAY,
      nature: "actual",
    });
    await createDirectCost(admin, {
      companyId: company.id,
      projectId: project.id,
      label: "Licence prévue",
      category: "license",
      amountCents: 99_900,
      incurredOn: TODAY,
      nature: "forecast",
    });
    await createTimeEntry(worker, {
      projectId: project.id,
      category: "production",
      minutes: 90,
      workOn: TODAY,
    });

    // Un contrat du même client : il compte pour le client, jamais pour le projet.
    const site = await createSite(member, { companyId: company.id, name: "Site marge" });
    contract = await createContract(admin, {
      companyId: company.id,
      name: "Maintenance marge",
      kind: "maintenance",
      priceCents: 9_900,
      period: "monthly",
      startOn: "2026-01-01",
    });
    await linkContractSite(admin, contract.id, { siteId: site.id });
    await changeContractStatus(admin, contract.id, { status: "active" });
    await createInvoiceReference(admin, {
      ...invoice,
      contractId: contract.id,
      externalRef: "MARGE-MAINT",
      amountCents: 9_900,
    });
    await createDirectCost(admin, {
      companyId: company.id,
      contractId: contract.id,
      label: "Hébergement",
      category: "hosting",
      amountCents: 1_000,
      incurredOn: TODAY,
      nature: "actual",
    });
    await createTimeEntry(worker, {
      contractId: contract.id,
      category: "support",
      minutes: 30,
      workOn: TODAY,
    });

    // Un autre client, pour vérifier qu'aucun chiffre ne se mélange.
    const other = await sellProject(world, "Autre Client");
    await createInvoiceReference(admin, {
      companyId: other.company.id,
      issuerMemberId,
      issuedOn: TODAY,
      projectId: other.project.id,
      externalRef: "AUTRE-1",
      amountCents: OTHER.revenue,
    });
  });
  afterAll(async () => world.close());

  it("le calcul donne les montants attendus, sans le prévisionnel", async () => {
    const { db } = world;
    expect((await getMargin(db, { scope: "project", id: project.id })).actual).toMatchObject({
      revenueCents: PROJECT.revenue,
      timeCostCents: PROJECT.time,
      minutes: 90,
      directCostCents: PROJECT.direct,
      totalCostCents: PROJECT.cost,
      marginCents: PROJECT.margin,
    });
    expect((await getMargin(db, { scope: "contract", id: contract.id })).actual).toMatchObject({
      revenueCents: CONTRACT.revenue,
      timeCostCents: CONTRACT.time,
      directCostCents: CONTRACT.direct,
      marginCents: CONTRACT.margin,
    });
    expect((await getMargin(db, { scope: "client", id: company.id })).actual).toMatchObject({
      revenueCents: CLIENT.revenue,
      timeCostCents: CLIENT.time,
      directCostCents: CLIENT.direct,
      totalCostCents: CLIENT.cost,
      marginCents: CLIENT.margin,
    });
  });

  it("le projet : fiche, finances et export donnent le même nombre", async () => {
    const { admin, db } = world;
    const source = await getMargin(db, { scope: "project", id: project.id });
    const detail = await getProjectDetail(admin, project.id);
    expect(detail.margin?.actual).toEqual(source.actual);
    expect(detail.margin?.forecast).toEqual(source.forecast);
    // Le coût du temps de la fiche est celui de la marge.
    expect(detail.planned?.consumedCents).toBe(source.actual.timeCostCents);
    expect(await getMarginForActor(admin, { scope: "project", id: project.id })).toEqual(source);

    const listed = await listProfitability(admin, "project", "Client Marge", ONE_PAGE);
    expect(listed.items.find((row) => row.id === project.id)?.margin.actual).toEqual(source.actual);
    const overview = await getProfitabilityOverview(admin);
    expect(overview.projects.find((row) => row.id === project.id)?.margin.actual).toEqual(
      source.actual,
    );

    const { csv } = await exportFinanceCsv(admin, "rentabilite-projets");
    const row = csv.split(/\r?\n/).find((line) => line.includes("Site Client Marge"));
    expect(row).toContain((PROJECT.margin / 100).toFixed(2).replace(".", ","));
  });

  it("le client : fiche et finances donnent le même nombre", async () => {
    const { admin, db } = world;
    const source = await getMargin(db, { scope: "client", id: company.id });
    const related = await loadCompanyRelated(admin, company.id);
    expect(related.margin).toMatchObject({ state: "ready" });
    if (related.margin.state !== "ready") throw new Error("Marge indisponible");
    expect(related.margin.data.actual).toEqual(source.actual);

    const listed = await listProfitability(admin, "client", null, ONE_PAGE);
    expect(listed.items.find((row) => row.id === company.id)?.margin.actual).toEqual(source.actual);
    const overview = await getProfitabilityOverview(admin);
    expect(overview.clients.find((row) => row.id === company.id)?.margin.actual).toEqual(
      source.actual,
    );
  });

  it("le contrat : fiche et finances donnent le même nombre", async () => {
    const { admin, db } = world;
    const source = await getMargin(db, { scope: "contract", id: contract.id });
    expect((await getContractRecord(admin, contract.id)).margin?.actual).toEqual(source.actual);
    const listed = await listProfitability(admin, "contract", null, ONE_PAGE);
    expect(listed.items.find((row) => row.id === contract.id)?.margin.actual).toEqual(
      source.actual,
    );
  });

  it("le tableau de bord et le reporting donnent le même nombre", async () => {
    const { admin, db } = world;
    const month = { from: `${TODAY.slice(0, 7)}-01`, to: TODAY };
    const period = await getPeriodMargin(db, month, NOW);
    expect(period).toMatchObject({
      revenueCents: AGENCY_REVENUE,
      marginCents: AGENCY_MARGIN,
      clients: 2,
    });
    const percent = (AGENCY_MARGIN / AGENCY_REVENUE) * 100;
    expect(period.percent).toBeCloseTo(percent, 6);
    const scoped = await getMargin(db, { scope: "client", id: company.id, period: month });
    expect(scoped.actual.marginCents).toBe(CLIENT.margin);

    const reporting = await getReporting(admin, { periode: "mois" }, NOW);
    if (reporting.margin?.status !== "ready") throw new Error("Marge du reporting indisponible");
    expect(reporting.margin.data.percent).toBeCloseTo(percent, 6);

    const dashboard = await getDashboard(admin, { editing: true, now: NEXT_MONTH });
    const tile = dashboard.tiles.monthly_report;
    if (tile?.status !== "ready") throw new Error("Rapport mensuel indisponible");
    const row = tile.view.rows?.find((entry) => entry.id === "margin");
    expect(row?.value).toBe(`${formatNumber(percent)} %`);
  });

  it("sans droit de lecture des finances, aucune marge ne sort", async () => {
    const { viewer, member } = world;
    for (const ctx of [viewer, member]) {
      expect((await getProjectDetail(ctx, project.id)).margin).toBeNull();
      expect((await loadCompanyRelated(ctx, company.id)).margin).toEqual({ state: "absent" });
      await expect(
        getMarginForActor(ctx, { scope: "project", id: project.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
