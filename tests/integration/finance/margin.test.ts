import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAverageActualMargin,
  getMargin,
  getMarginForActor,
  getMargins,
  listProfitability,
} from "@/modules/finance/profitability.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createProject,
  createQuote,
  createSite,
  createTeamMember,
} from "../../helpers/factories";

const NOW = new Date("2026-11-04T12:00:00Z");

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let memberId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createTestContext(db, "admin");
  memberId = (await createTeamMember(db)).id;
});
afterAll(async () => close());

let refCounter = 0;
async function addInvoice(
  values: Partial<typeof schema.financialDocuments.$inferInsert> & { companyId: string },
) {
  await db.insert(schema.financialDocuments).values({
    source: "manual",
    externalRef: `M-${(refCounter += 1)}`,
    issuedOn: "2026-10-10",
    amountCents: 0,
    ...values,
  });
}

async function addTime(
  values: Partial<typeof schema.timeEntries.$inferInsert> & { companyId: string },
) {
  await db.insert(schema.timeEntries).values({
    memberId,
    workOn: "2026-10-12",
    minutes: 60,
    category: "production",
    hourlyCostCents: 6000,
    ...values,
  });
}

async function addCost(
  values: Partial<typeof schema.directCosts.$inferInsert> & { label?: string },
) {
  await db.insert(schema.directCosts).values({
    label: "Coût",
    category: "other",
    amountCents: 0,
    incurredOn: "2026-10-15",
    nature: "actual",
    ...values,
  });
}

describe("getMargin : projet", () => {
  it("sépare prévu et réalisé, et explique ce qui est compté", async () => {
    const company = await createCompany(db);
    const { quote, version } = await createQuote(
      db,
      { companyId: company.id, status: "accepted" },
      { totalCents: 780000, estimatedCostCents: 240000, estimatedMinutes: 5040 },
    );
    const project = await createProject(db, { companyId: company.id, quoteId: quote.id });
    await db
      .update(schema.quotes)
      .set({ acceptedVersionId: version.id })
      .where(eq(schema.quotes.id, quote.id));

    await addInvoice({
      companyId: company.id,
      projectId: project.id,
      amountCents: 234000,
      status: "paid",
      paidOn: "2026-10-20",
    });
    await addInvoice({ companyId: company.id, projectId: project.id, amountCents: 546000 });
    // Annulée : hors calcul.
    await addInvoice({
      companyId: company.id,
      projectId: project.id,
      amountCents: 999999,
      status: "cancelled",
    });
    await addInvoice({
      companyId: company.id,
      projectId: project.id,
      kind: "credit_note",
      amountCents: -10000,
    });
    await addCost({
      companyId: company.id,
      projectId: project.id,
      category: "subcontracting",
      amountCents: 90000,
      nature: "actual",
    });
    await addCost({
      companyId: company.id,
      projectId: project.id,
      category: "subcontracting",
      amountCents: 135000,
      nature: "forecast",
    });
    await addTime({
      companyId: company.id,
      projectId: project.id,
      minutes: 120,
      hourlyCostCents: 6000,
    });
    await addTime({
      companyId: company.id,
      projectId: project.id,
      minutes: 30,
      hourlyCostCents: 4000,
    });

    const margin = await getMargin(db, { scope: "project", id: project.id }, NOW);

    expect(margin.forecast).toMatchObject({
      revenueCents: 780000,
      timeCostCents: 240000,
      minutes: 5040,
      directCostCents: 135000,
      totalCostCents: 375000,
      marginCents: 405000,
    });
    expect(margin.forecast.marginPercent).toBeCloseTo(51.92, 1);

    // 120 min × 60 € + 30 min × 40 € = 120 € + 20 € : le coût horaire figé à la saisie.
    expect(margin.actual).toMatchObject({
      revenueCents: 770000,
      timeCostCents: 14000,
      minutes: 150,
      directCostCents: 90000,
      totalCostCents: 104000,
      marginCents: 666000,
    });
    expect(margin.actual.lines.map((line) => line.kind)).toEqual(
      expect.arrayContaining(["invoice", "credit_note", "direct_cost", "time"]),
    );
    expect(margin.forecast.lines.map((line) => line.kind)).toEqual(
      expect.arrayContaining(["quote", "time_estimate", "direct_cost"]),
    );
    expect(margin.actual.unavailable).toEqual([]);
  });

  it("sans facture : revenu réel indisponible, jamais zéro ; les coûts restent connus", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    await addCost({ companyId: company.id, projectId: project.id, amountCents: 5000 });

    const margin = await getMargin(db, { scope: "project", id: project.id }, NOW);
    expect(margin.actual).toMatchObject({
      revenueCents: null,
      marginCents: null,
      marginPercent: null,
      totalCostCents: 5000,
    });
    expect(margin.actual.unavailable[0]).toContain("indisponible");
    expect(margin.forecast).toMatchObject({ revenueCents: null, marginPercent: null });
    expect(margin.forecast.unavailable[0]).toContain("ni devis ni budget");
  });

  it("sans devis, le budget du projet tient lieu de prévision et le dit", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id, budgetCents: 50000 });
    const margin = await getMargin(db, { scope: "project", id: project.id }, NOW);
    expect(margin.forecast.revenueCents).toBe(50000);
    expect(margin.forecast.lines[0]).toMatchObject({ kind: "budget" });
  });

  it("une période filtre revenus, coûts et temps ; le prévu vient des échéances", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id, budgetCents: 100000 });
    await addInvoice({
      companyId: company.id,
      projectId: project.id,
      amountCents: 1000,
      issuedOn: "2026-09-10",
    });
    await addInvoice({
      companyId: company.id,
      projectId: project.id,
      amountCents: 2000,
      issuedOn: "2026-10-10",
    });
    await addCost({
      companyId: company.id,
      projectId: project.id,
      amountCents: 100,
      incurredOn: "2026-09-15",
    });
    await addCost({
      companyId: company.id,
      projectId: project.id,
      amountCents: 200,
      incurredOn: "2026-10-15",
    });
    await addTime({ companyId: company.id, projectId: project.id, workOn: "2026-09-12" });
    await addTime({
      companyId: company.id,
      projectId: project.id,
      workOn: "2026-10-12",
      minutes: 30,
    });
    await db.insert(schema.paymentScheduleItems).values({
      companyId: company.id,
      projectId: project.id,
      label: "Solde",
      dueOn: "2026-10-30",
      amountCents: 40000,
    });

    const margin = await getMargin(
      db,
      { scope: "project", id: project.id, period: { from: "2026-10-01", to: "2026-10-31" } },
      NOW,
    );
    expect(margin.actual).toMatchObject({
      revenueCents: 2000,
      directCostCents: 200,
      timeCostCents: 3000,
      minutes: 30,
    });
    expect(margin.forecast.revenueCents).toBe(40000);
  });

  it("refuse une entrée invalide et répond 404 pour un objet inconnu", async () => {
    await expect(getMargin(db, { scope: "project", id: "pas-un-uuid" }, NOW)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      getMargin(db, { scope: "project", id: "00000000-0000-4000-8000-000000000000" }, NOW),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("getMargin : contrat", () => {
  it("revenu réel depuis les factures référencées, prévision depuis son devis", async () => {
    const company = await createCompany(db);
    const { quote } = await createQuote(
      db,
      { companyId: company.id, status: "accepted" },
      { totalCents: 120000, estimatedCostCents: 30000, estimatedMinutes: 600 },
    );
    const contract = await createContract(db, {
      companyId: company.id,
      quoteId: quote.id,
      priceCents: 10000,
      period: "monthly",
      startOn: "2026-01-01",
    });
    await addInvoice({ companyId: company.id, contractId: contract.id, amountCents: 10000 });
    await addInvoice({ companyId: company.id, contractId: contract.id, amountCents: 10000 });
    await addTime({ companyId: company.id, contractId: contract.id, category: "support" });
    await addCost({
      companyId: company.id,
      contractId: contract.id,
      category: "hosting",
      amountCents: 1500,
      incurredOn: "2026-09-10",
      recurringPeriod: "monthly",
    });

    const margin = await getMargin(db, { scope: "contract", id: contract.id }, NOW);
    expect(margin.forecast).toMatchObject({ revenueCents: 120000, timeCostCents: 30000 });
    // Récurrence mensuelle du 10 sept. : 10 sept., 10 oct. Le 10 nov. n'est pas encore tombé.
    expect(margin.actual).toMatchObject({
      revenueCents: 20000,
      directCostCents: 3000,
      timeCostCents: 6000,
    });
  });

  it("sans devis, prix × périodes, et le coût mensuel estimé en prévision", async () => {
    const company = await createCompany(db);
    const contract = await createContract(db, {
      companyId: company.id,
      priceCents: 30000,
      period: "quarterly",
      monthlyCostCents: 2000,
      startOn: "2026-02-01",
    });
    const margin = await getMargin(db, { scope: "contract", id: contract.id }, NOW);
    // 1er fév., 1er mai, 1er août, 1er nov. : 4 trimestres. 10 mois de fév. à nov.
    expect(margin.forecast.revenueCents).toBe(120000);
    expect(margin.forecast.directCostCents).toBe(20000);
    expect(margin.actual.revenueCents).toBeNull();
  });

  it("un devis qui finance déjà un projet ne compte pas deux fois chez le client", async () => {
    const company = await createCompany(db);
    const { quote } = await createQuote(
      db,
      { companyId: company.id, status: "accepted" },
      { totalCents: 500000 },
    );
    await createProject(db, { companyId: company.id, quoteId: quote.id });
    const contract = await createContract(db, {
      companyId: company.id,
      quoteId: quote.id,
      priceCents: 10000,
      period: "monthly",
      startOn: "2026-10-01",
    });

    const client = await getMargin(db, { scope: "client", id: company.id }, NOW);
    // Devis 5 000 € + 2 mois de contrat (1er oct., 1er nov.) à 100 €.
    expect(client.forecast.revenueCents).toBe(520000);
    const alone = await getMargin(db, { scope: "contract", id: contract.id }, NOW);
    expect(alone.forecast.revenueCents).toBe(20000);
  });
});

describe("getMargin : client et site", () => {
  it("le client additionne projets, contrats et frais sans projet ; rien d'un autre client", async () => {
    const [company, other] = [await createCompany(db), await createCompany(db)];
    const project = await createProject(db, { companyId: company.id });
    const contract = await createContract(db, { companyId: company.id });
    await addInvoice({ companyId: company.id, projectId: project.id, amountCents: 100000 });
    await addInvoice({ companyId: company.id, contractId: contract.id, amountCents: 20000 });
    await addInvoice({ companyId: other.id, amountCents: 999999 });
    await addCost({ companyId: company.id, projectId: project.id, amountCents: 1000 });
    await addCost({ companyId: company.id, amountCents: 2000 });
    await addCost({ companyId: other.id, amountCents: 999999 });
    await addTime({ companyId: company.id, projectId: project.id });
    await addTime({ companyId: other.id });

    const margin = await getMargin(db, { scope: "client", id: company.id }, NOW);
    expect(margin.actual).toMatchObject({
      revenueCents: 120000,
      directCostCents: 3000,
      timeCostCents: 6000,
      marginCents: 111000,
    });
  });

  it("le site reçoit son projet et sa part de contrat ; un coût d'un autre site n'y entre pas", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const contract = await createContract(db, { companyId: company.id });
    const site = await createSite(db, {
      companyId: company.id,
      projectId: project.id,
      contractId: contract.id,
    });
    const sibling = await createSite(db, { companyId: company.id });
    await db.insert(schema.contractSites).values([
      { contractId: contract.id, siteId: site.id, companyId: company.id },
      { contractId: contract.id, siteId: sibling.id, companyId: company.id },
    ]);
    await addInvoice({ companyId: company.id, projectId: project.id, amountCents: 100000 });
    await addInvoice({ companyId: company.id, contractId: contract.id, amountCents: 20000 });
    await addCost({ companyId: company.id, siteId: site.id, amountCents: 500 });
    await addCost({ companyId: company.id, siteId: sibling.id, amountCents: 7000 });
    await addCost({ companyId: company.id, contractId: contract.id, amountCents: 800 });

    const margin = await getMargin(db, { scope: "site", id: site.id }, NOW);
    // 1 000 € de projet + moitié de 200 € de contrat ; 5 € sur le site + moitié de 8 €.
    expect(margin.actual).toMatchObject({ revenueCents: 110000, directCostCents: 900 });
  });
});

describe("source unique", () => {
  it("getMargins donne exactement le même calcul que getMargin", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id, budgetCents: 90000 });
    await addInvoice({ companyId: company.id, projectId: project.id, amountCents: 30000 });
    await addTime({ companyId: company.id, projectId: project.id });
    const one = await getMargin(db, { scope: "project", id: project.id }, NOW);
    const batch = await getMargins(db, { scope: "project", ids: [project.id] }, NOW);
    expect(batch.get(project.id)).toEqual(one);
  });

  it("la marge moyenne est pondérée par le revenu", async () => {
    const isolated = await createTestDatabase();
    try {
      const company = await createCompany(isolated.db);
      const [big, small] = [
        await createProject(isolated.db, { companyId: company.id }),
        await createProject(isolated.db, { companyId: company.id }),
      ];
      await isolated.db.insert(schema.financialDocuments).values([
        {
          companyId: company.id,
          projectId: big.id,
          source: "manual",
          externalRef: "B",
          amountCents: 900000,
          issuedOn: "2026-10-01",
        },
        {
          companyId: company.id,
          projectId: small.id,
          source: "manual",
          externalRef: "S",
          amountCents: 100000,
          issuedOn: "2026-10-02",
        },
      ]);
      await isolated.db.insert(schema.directCosts).values([
        {
          companyId: company.id,
          projectId: big.id,
          label: "A",
          category: "other",
          amountCents: 450000,
          incurredOn: "2026-10-01",
        },
        {
          companyId: company.id,
          projectId: small.id,
          label: "B",
          category: "other",
          amountCents: 0,
          incurredOn: "2026-10-01",
        },
      ]);
      const average = await getAverageActualMargin(isolated.db, NOW);
      expect(average.projects).toBe(2);
      expect(average.percent).toBeCloseTo(55, 5);
    } finally {
      await isolated.close();
    }
  });

  it("un coût récurrent à zéro est signalé à chiffrer, pas compté", async () => {
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    await addCost({
      companyId: company.id,
      projectId: project.id,
      label: "VPS OVH",
      amountCents: 0,
      recurringPeriod: "monthly",
    });
    const margin = await getMargin(db, { scope: "project", id: project.id }, NOW);
    expect(margin.actual.unavailable.join(" ")).toContain("VPS OVH");
    expect(margin.actual.directCostCents).toBe(0);
  });
});

describe("droits", () => {
  it("seul un associé lit la marge par les services d'écran", async () => {
    const company = await createCompany(db);
    for (const role of ["member", "contractor", "viewer"] as const) {
      const ctx = await createTestContext(db, role);
      await expect(getMarginForActor(ctx, { scope: "client", id: company.id })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        listProfitability(ctx, "project", null, { page: 1, pageSize: 5 }),
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("les listes de rentabilité sont paginées pour chaque portée", async () => {
    for (const scope of ["project", "client", "site", "contract"] as const) {
      const page = await listProfitability(admin, scope, null, { page: 1, pageSize: 2 }, NOW);
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.pageSize).toBe(2);
    }
  });
});
