import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateContractsForSite,
  addContractNote,
  archiveContract,
  assertContractReadable,
  changeContractPrice,
  changeContractStatus,
  consumeContractQuota,
  convertOverage,
  createContract,
  getContractRecord,
  getContractsOverview,
  getContractsSummary,
  getRecurringRevenue,
  linkContractSite,
  listContracts,
  listContractsDueForRenewal,
  listContractsForCompany,
  listContractsForPortal,
  listContractsForSite,
  renewContract,
  resolveCoverage,
  runContractDeadlines,
  terminateContract,
  unlinkContractSite,
  updateContract,
  updateContractSignature,
} from "@/modules/contracts/contract.service";
import {
  completeIntervention,
  createIntervention,
  listInterventions,
  updateIntervention,
} from "@/modules/contracts/intervention.service";
import {
  createMaintenancePlan,
  listMaintenancePlans,
  setMaintenancePlanActive,
  updateMaintenancePlan,
} from "@/modules/contracts/maintenance-plan.service";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract as insertContract,
  createPortalTestContext,
  createSite,
  createTeamMember,
  createTicket,
} from "../../helpers/factories";

const PAGE = { page: 1, pageSize: 25 };
const NOW = new Date("2026-11-04T10:00:00Z");
const TODAY = "2026-11-04";

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let member: ServiceContext;
let contractor: ServiceContext;
let viewer: ServiceContext;
let client: ServiceContext;

beforeAll(async () => {
  const database = await createTestDatabase();
  db = database.db;
  close = database.close;
  admin = await createTestContext(db, "admin");
  member = await createTestContext(db, "member");
  contractor = await createTestContext(db, "contractor");
  viewer = await createTestContext(db, "viewer");
  client = await createTestContext(db, "client");
});

afterAll(async () => {
  await close();
});

const validInput = (companyId: string, overrides: Record<string, unknown> = {}) => ({
  companyId,
  name: `Maintenance ${Math.random().toString(36).slice(2)}`,
  kind: "maintenance",
  priceCents: "12900",
  period: "monthly",
  ...overrides,
});

/** Contrat en vigueur, inséré directement pour isoler la règle testée. */
async function activeContract(
  overrides: Partial<typeof s.contracts.$inferInsert> = {},
): Promise<s.Contract> {
  const companyId = overrides.companyId ?? (await createCompany(db)).id;
  return insertContract(db, {
    status: "active",
    startOn: "2026-01-01",
    priceCents: 10000,
    period: "monthly",
    ...overrides,
    companyId,
  });
}

const eventsOf = (id: string) =>
  db.select().from(s.contractEvents).where(eq(s.contractEvents.contractId, id));

const domainEventsOf = (id: string, type: string) =>
  db
    .select()
    .from(s.domainEvents)
    .where(and(eq(s.domainEvents.entityId, id), eq(s.domainEvents.type, type)));

const auditOf = (id: string, action: string) =>
  db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, action)));

describe("permissions et périmètre", () => {
  it("refuse toute lecture au prestataire et au client", async () => {
    const contract = await activeContract();
    for (const ctx of [contractor, client]) {
      await expect(listContracts(ctx, {}, PAGE)).rejects.toThrow(ForbiddenError);
      await expect(getContractsOverview(ctx)).rejects.toThrow(ForbiddenError);
      await expect(getContractRecord(ctx, contract.id)).rejects.toThrow(ForbiddenError);
      await expect(listContractsForCompany(ctx, contract.companyId)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(listInterventions(ctx, contract.id, PAGE)).rejects.toThrow(ForbiddenError);
      await expect(listMaintenancePlans(ctx)).rejects.toThrow(ForbiddenError);
    }
  });

  it("laisse lire le lecteur, sans rien écrire", async () => {
    const contract = await activeContract();
    await expect(getContractRecord(viewer, contract.id)).resolves.toBeTruthy();
    const company = await createCompany(db);
    await expect(createContract(viewer, validInput(company.id))).rejects.toThrow(ForbiddenError);
    await expect(updateContract(viewer, contract.id, {})).rejects.toThrow(ForbiddenError);
    await expect(
      changeContractStatus(viewer, contract.id, { status: "to_review" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createIntervention(viewer, contract.id, { title: "x", plannedOn: TODAY }),
    ).rejects.toThrow(ForbiddenError);
    await expect(createMaintenancePlan(viewer, { name: "x" })).rejects.toThrow(ForbiddenError);
  });

  it("réserve la résiliation et l'archivage à l'associé", async () => {
    const contract = await activeContract();
    await expect(terminateContract(member, contract.id, { note: "Fin" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(archiveContract(member, contract.id)).rejects.toThrow(ForbiddenError);
  });

  it("masque le coût à qui ne lit ni finances ni coûts", async () => {
    const contract = await activeContract({ monthlyCostCents: 3000 });
    expect((await getContractRecord(admin, contract.id)).contract.monthlyCostCents).toBe(3000);
    expect((await getContractRecord(member, contract.id)).contract.monthlyCostCents).toBeNull();
    expect((await getContractRecord(viewer, contract.id)).contract.monthlyCostCents).toBeNull();
  });

  it("ne laisse pas un collaborateur écraser un coût qu'il ne voit pas", async () => {
    const contract = await activeContract({ monthlyCostCents: 3000 });
    await updateContract(member, contract.id, {
      name: contract.name,
      kind: contract.kind,
      period: contract.period,
      monthlyCostCents: "1",
    });
    const [row] = await db.select().from(s.contracts).where(eq(s.contracts.id, contract.id));
    expect(row?.monthlyCostCents).toBe(3000);
  });

  it("répond 404 pour un contrat inconnu ou archivé", async () => {
    await expect(getContractRecord(admin, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      NotFoundError,
    );
    const contract = await insertContract(db, { status: "to_start" });
    await archiveContract(admin, contract.id);
    await expect(getContractRecord(admin, contract.id)).rejects.toThrow(NotFoundError);
  });

  it("ne montre au portail que les contrats de son client, sans coût", async () => {
    const portal = await createPortalTestContext(db);
    const mine = await activeContract({ companyId: portal.companyId, monthlyCostCents: 500 });
    await insertContract(db, { companyId: portal.companyId, status: "to_start" });
    await activeContract();
    const rows = await listContractsForPortal(portal, { now: NOW });
    expect(rows.map((row) => row.id)).toEqual([mine.id]);
    expect(rows[0]).not.toHaveProperty("monthlyCostCents");
    expect(rows[0]).not.toHaveProperty("conditions");
  });
});

describe("création et modification", () => {
  it("crée un contrat à démarrer, numéroté, historisé et audité", async () => {
    const company = await createCompany(db);
    const contract = await createContract(member, validInput(company.id));
    expect(contract.status).toBe("to_start");
    expect(contract.number).toMatch(/^C-\d{4}-\d{3}$/);
    expect(contract.priceCents).toBe(12900);
    expect((await eventsOf(contract.id)).map((event) => event.kind)).toEqual(["created"]);
    expect(await auditOf(contract.id, "contract.created")).toHaveLength(1);
  });

  it("valide par champ", async () => {
    const company = await createCompany(db);
    await expect(
      createContract(member, validInput(company.id, { name: " ", priceCents: "abc" })),
    ).rejects.toMatchObject({
      fieldErrors: { name: expect.any(Array), priceCents: expect.any(Array) },
    });
    await expect(
      createContract(
        member,
        validInput(company.id, { startOn: "2026-05-01", endOn: "2026-04-01" }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { endOn: expect.any(Array) } });
    await expect(
      createContract(member, validInput(company.id, { startOn: "2026-02-31" })),
    ).rejects.toThrow(ValidationError);
  });

  it("refuse un client inconnu et le devis d'un autre client", async () => {
    await expect(
      createContract(member, validInput("00000000-0000-4000-8000-000000000000")),
    ).rejects.toThrow(NotFoundError);

    const company = await createCompany(db);
    const other = await createCompany(db);
    const [quote] = await db
      .insert(s.quotes)
      .values({ number: "TEST-D-CROSS", title: "Offre", companyId: other.id })
      .returning();
    await expect(
      createContract(member, validInput(company.id, { quoteId: quote?.id })),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuse un second contrat en cours du même nom : double envoi sans doublon", async () => {
    const company = await createCompany(db);
    const input = validInput(company.id, { name: "Hébergement principal" });
    await createContract(member, input);
    await expect(createContract(member, input)).rejects.toThrow(ConflictError);
    await expect(
      createContract(member, { ...input, name: "HÉBERGEMENT PRINCIPAL" }),
    ).rejects.toThrow(ConflictError);
  });

  it("reprend les valeurs de la formule pour les champs laissés vides", async () => {
    const plan = await createMaintenancePlan(admin, {
      name: "Formule reprise",
      priceCents: "5000",
      period: "monthly",
      includedMinutes: "120",
      includedTickets: "2",
      scope: "Mises à jour",
      exclusions: "Évolutions",
      responseHours: "24",
      resolutionHours: "48",
    });
    const company = await createCompany(db);
    const contract = await createContract(
      member,
      validInput(company.id, { planId: plan.id, includedTickets: "5" }),
    );
    expect(contract).toMatchObject({
      planId: plan.id,
      includedMinutes: 120,
      includedTickets: 5,
      scope: "Mises à jour",
      exclusions: "Évolutions",
      responseHours: 24,
      resolutionHours: 48,
    });
  });

  it("refuse une formule retirée", async () => {
    const plan = await createMaintenancePlan(admin, {
      name: "Formule retirée",
      priceCents: "5000",
      period: "monthly",
    });
    await setMaintenancePlanActive(admin, plan.id, false);
    const company = await createCompany(db);
    await expect(
      createContract(member, validInput(company.id, { planId: plan.id })),
    ).rejects.toThrow(ValidationError);
  });

  it("modifie un contrat, sauf s'il est terminé", async () => {
    const contract = await activeContract();
    const updated = await updateContract(member, contract.id, {
      name: "Nouveau nom",
      kind: "support",
      period: contract.period,
      scope: "Périmètre",
      exclusions: "Exclusions",
      conditions: "Conditions",
    });
    expect(updated).toMatchObject({
      name: "Nouveau nom",
      kind: "support",
      scope: "Périmètre",
      exclusions: "Exclusions",
      conditions: "Conditions",
      priceCents: contract.priceCents,
    });
    expect(await auditOf(contract.id, "contract.updated")).toHaveLength(1);

    await terminateContract(admin, contract.id, { note: "Fin" }, { now: NOW });
    await expect(
      updateContract(member, contract.id, {
        name: "Encore",
        kind: "support",
        period: contract.period,
      }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("machine à états", () => {
  it("démarre un contrat : début fixé, échéance calculée si renouvellement automatique", async () => {
    const contract = await insertContract(db, {
      status: "to_start",
      autoRenew: true,
      period: "monthly",
    });
    const started = await changeContractStatus(
      member,
      contract.id,
      { status: "active" },
      { now: NOW },
    );
    expect(started).toMatchObject({
      status: "active",
      startOn: TODAY,
      renewsOn: "2026-12-04",
    });
  });

  it("suit active ⇄ to_review et active ⇄ suspended, avec historique", async () => {
    const contract = await activeContract();
    expect((await changeContractStatus(member, contract.id, { status: "to_review" })).status).toBe(
      "to_review",
    );
    expect((await changeContractStatus(member, contract.id, { status: "active" })).status).toBe(
      "active",
    );
    expect(
      (await changeContractStatus(member, contract.id, { status: "suspended", note: "Impayé" }))
        .status,
    ).toBe("suspended");
    expect((await changeContractStatus(member, contract.id, { status: "active" })).status).toBe(
      "active",
    );

    const events = await eventsOf(contract.id);
    expect(events.filter((event) => event.kind === "suspended")).toHaveLength(1);
    expect(await auditOf(contract.id, "contract.suspended")).toHaveLength(1);
    expect(await auditOf(contract.id, "contract.status_changed")).toHaveLength(3);
  });

  it("ne répète rien quand l'état demandé est déjà le bon", async () => {
    const contract = await activeContract();
    await changeContractStatus(member, contract.id, { status: "to_review" });
    await changeContractStatus(member, contract.id, { status: "to_review" });
    expect(await eventsOf(contract.id)).toHaveLength(1);
  });

  it.each([
    ["to_start", "to_review"],
    ["to_start", "suspended"],
    ["to_review", "suspended"],
    ["suspended", "to_review"],
    ["terminated", "active"],
    ["expired", "active"],
  ] as const)("refuse %s → %s", async (from, to) => {
    const contract = await activeContract({ status: from });
    await expect(changeContractStatus(member, contract.id, { status: to })).rejects.toThrow(
      ConflictError,
    );
  });

  it("refuse une cible hors machine, comme un retour à « à démarrer »", async () => {
    const contract = await activeContract();
    await expect(changeContractStatus(member, contract.id, { status: "to_start" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      changeContractStatus(member, contract.id, { status: "terminated" }),
    ).rejects.toThrow(ValidationError);
  });

  it("n'accepte l'expiration qu'une fois la fin atteinte", async () => {
    const running = await activeContract({ endOn: "2027-01-01" });
    await expect(
      changeContractStatus(member, running.id, { status: "expired" }, { now: NOW }),
    ).rejects.toThrow(ConflictError);
    const open = await activeContract();
    await expect(
      changeContractStatus(member, open.id, { status: "expired" }, { now: NOW }),
    ).rejects.toThrow(ConflictError);
    const ended = await activeContract({ endOn: "2026-10-31" });
    expect(
      (await changeContractStatus(member, ended.id, { status: "expired" }, { now: NOW })).status,
    ).toBe("expired");
  });
});

describe("révision de tarif", () => {
  it("historise le changement et l'audite", async () => {
    const contract = await activeContract({ priceCents: 4900 });
    const updated = await changeContractPrice(member, contract.id, {
      priceCents: "5900",
      period: "monthly",
      note: "Révision annuelle",
    });
    expect(updated.priceCents).toBe(5900);
    const [event] = (await eventsOf(contract.id)).filter((row) => row.kind === "price_change");
    expect(event).toMatchObject({
      fromPriceCents: 4900,
      toPriceCents: 5900,
      note: "Révision annuelle",
    });
    expect(await auditOf(contract.id, "contract.price_changed")).toHaveLength(1);
  });

  it("n'écrit rien pour un prix identique", async () => {
    const contract = await activeContract({ priceCents: 4900 });
    await changeContractPrice(member, contract.id, { priceCents: "4900", period: "monthly" });
    expect(await eventsOf(contract.id)).toHaveLength(0);
  });

  it("refuse un prix négatif et un contrat terminé", async () => {
    const contract = await activeContract();
    await expect(
      changeContractPrice(member, contract.id, { priceCents: "-1", period: "monthly" }),
    ).rejects.toThrow(ValidationError);
    const ended = await activeContract({ status: "terminated" });
    await expect(
      changeContractPrice(member, ended.id, { priceCents: "1", period: "monthly" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("renouvellement", () => {
  it("avance l'échéance d'une période et l'historise", async () => {
    const contract = await activeContract({ renewsOn: "2026-12-01", period: "quarterly" });
    const renewed = await renewContract(member, contract.id, { note: "Accord du client" });
    expect(renewed.renewsOn).toBe("2027-03-01");
    expect((await eventsOf(contract.id)).map((event) => event.kind)).toEqual(["renewed"]);
    expect(await auditOf(contract.id, "contract.renewed")).toHaveLength(1);
  });

  it("déplace aussi la date de fin", async () => {
    const both = await activeContract({ renewsOn: "2026-12-01", endOn: "2027-01-01" });
    expect(await renewContract(member, both.id, {})).toMatchObject({
      renewsOn: "2027-01-01",
      endOn: "2027-02-01",
    });
    const onlyEnd = await activeContract({ endOn: "2026-12-01" });
    expect(await renewContract(member, onlyEnd.id, {})).toMatchObject({
      renewsOn: null,
      endOn: "2027-01-01",
    });
  });

  it("ne renouvelle qu'une fois pour la même échéance vue à l'écran", async () => {
    const contract = await activeContract({ renewsOn: "2026-12-01" });
    const input = { expectedNextOn: "2026-12-01" };
    await renewContract(member, contract.id, input);
    const again = await renewContract(member, contract.id, input);
    expect(again.renewsOn).toBe("2027-01-01");
    expect(await eventsOf(contract.id)).toHaveLength(1);
  });

  it("accepte une date choisie, à condition qu'elle suive l'échéance", async () => {
    const contract = await activeContract({ renewsOn: "2026-12-01" });
    await expect(renewContract(member, contract.id, { newRenewsOn: "2026-12-01" })).rejects.toThrow(
      ValidationError,
    );
    expect((await renewContract(member, contract.id, { newRenewsOn: "2027-06-01" })).renewsOn).toBe(
      "2027-06-01",
    );
  });

  it("refuse hors vigueur et sans échéance", async () => {
    for (const status of ["to_start", "suspended", "terminated", "expired"] as const) {
      const contract = await activeContract({ status, renewsOn: "2026-12-01" });
      await expect(renewContract(member, contract.id, {})).rejects.toThrow(ConflictError);
    }
    const open = await activeContract();
    await expect(renewContract(member, open.id, {})).rejects.toThrow(ConflictError);
  });
});

describe("résiliation", () => {
  it("clôt le contrat, annule le prévu, garde le réalisé, audite et émet", async () => {
    const contract = await activeContract({ renewsOn: "2026-12-01", autoRenew: true });
    const planned = await createIntervention(member, contract.id, {
      title: "Prévue",
      plannedOn: "2026-12-10",
    });
    const done = await createIntervention(
      member,
      contract.id,
      { title: "Faite", doneOn: "2026-10-10", minutes: "30" },
      { now: NOW },
    );

    const ended = await terminateContract(
      admin,
      contract.id,
      { note: "Départ du client" },
      { now: NOW },
    );
    expect(ended).toMatchObject({
      status: "terminated",
      terminationNote: "Départ du client",
      endOn: TODAY,
      renewsOn: null,
      autoRenew: false,
    });
    expect(ended.terminatedAt).toEqual(NOW);
    expect(await domainEventsOf(contract.id, "contract.terminated")).toHaveLength(1);
    expect(await auditOf(contract.id, "contract.terminated")).toHaveLength(1);
    expect((await eventsOf(contract.id)).map((event) => event.kind)).toContain("terminated");

    const { items } = await listInterventions(admin, contract.id, PAGE);
    expect(items.find((row) => row.id === planned.id)?.cancelled).toBe(true);
    expect(items.find((row) => row.id === done.id)).toMatchObject({
      cancelled: false,
      doneOn: "2026-10-10",
    });
  });

  it("est idempotente", async () => {
    const contract = await activeContract();
    await terminateContract(admin, contract.id, { note: "Fin" }, { now: NOW });
    await terminateContract(admin, contract.id, { note: "Encore" }, { now: NOW });
    expect(await domainEventsOf(contract.id, "contract.terminated")).toHaveLength(1);
    expect((await eventsOf(contract.id)).filter((e) => e.kind === "terminated")).toHaveLength(1);
    const [row] = await db.select().from(s.contracts).where(eq(s.contracts.id, contract.id));
    expect(row?.terminationNote).toBe("Fin");
  });

  it("n'accepte que depuis un état autorisé par la machine", async () => {
    for (const status of ["to_start", "to_review", "expired"] as const) {
      const contract = await activeContract({ status });
      await expect(
        terminateContract(admin, contract.id, { note: "Fin" }, { now: NOW }),
      ).rejects.toThrow(ConflictError);
    }
    const suspended = await activeContract({ status: "suspended" });
    expect(
      (await terminateContract(admin, suspended.id, { note: "Fin" }, { now: NOW })).status,
    ).toBe("terminated");
  });

  it("exige un motif et une date cohérente", async () => {
    const contract = await activeContract();
    await expect(terminateContract(admin, contract.id, { note: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      terminateContract(
        admin,
        contract.id,
        { note: "Fin", effectiveOn: "2026-12-01" },
        { now: NOW },
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      terminateContract(
        admin,
        contract.id,
        { note: "Fin", effectiveOn: "2025-12-01" },
        { now: NOW },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("liste les services à arrêter sur la fiche", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const site = await createSite(db, { companyId: company.id, status: "live" });
    await linkContractSite(member, contract.id, { siteId: site.id });
    await createIntervention(member, contract.id, { title: "Prévue", plannedOn: "2026-12-10" });
    await createTicket(db, { companyId: company.id, contractId: contract.id, status: "received" });
    await createTicket(db, { companyId: company.id, contractId: contract.id, status: "closed" });
    await db.insert(s.directCosts).values({
      companyId: company.id,
      contractId: contract.id,
      label: "Serveur",
      category: "hosting",
      amountCents: 900,
      incurredOn: "2026-01-01",
      recurringPeriod: "monthly",
    });

    const asAdmin = (await getContractRecord(admin, contract.id)).impact;
    expect(asAdmin.sites.map((row) => row.siteId)).toEqual([site.id]);
    expect(asAdmin.plannedInterventions).toBe(1);
    expect(asAdmin.openTickets).toBe(1);
    expect(asAdmin.recurringCosts).toEqual([
      { label: "Serveur", amountCents: 900, period: "monthly" },
    ]);

    const asMember = (await getContractRecord(member, contract.id)).impact;
    expect(asMember.recurringCosts).toBeNull();
    expect(asMember.plannedScheduleItems).toBeNull();
  });
});

describe("archivage", () => {
  it("refuse un contrat en vigueur, accepte un contrat terminé et le retire des listes", async () => {
    const running = await activeContract();
    await expect(archiveContract(admin, running.id)).rejects.toThrow(ConflictError);

    const company = await createCompany(db, { name: "Client archivage" });
    const ended = await activeContract({ companyId: company.id, status: "terminated" });
    await archiveContract(admin, ended.id);
    expect(await auditOf(ended.id, "contract.archived")).toHaveLength(1);
    const page = await listContracts(admin, { filter: "all", search: "Client archivage" }, PAGE);
    expect(page.items).toHaveLength(0);
    // La ligne reste en base : archiver n'est pas supprimer.
    const [row] = await db.select().from(s.contracts).where(eq(s.contracts.id, ended.id));
    expect(row?.archivedAt).toBeInstanceOf(Date);
  });
});

describe("sites rattachés", () => {
  it("rattache et retire, de façon idempotente", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const site = await createSite(db, { companyId: company.id });

    await linkContractSite(member, contract.id, { siteId: site.id });
    await linkContractSite(member, contract.id, { siteId: site.id });
    expect((await getContractRecord(admin, contract.id)).sites).toHaveLength(1);
    expect(await auditOf(contract.id, "contract.site_linked")).toHaveLength(1);
    expect((await listContractsForSite(member, site.id)).map((row) => row.id)).toEqual([
      contract.id,
    ]);

    await unlinkContractSite(member, contract.id, { siteId: site.id });
    await unlinkContractSite(member, contract.id, { siteId: site.id });
    expect((await getContractRecord(admin, contract.id)).sites).toHaveLength(0);
    expect(await auditOf(contract.id, "contract.site_unlinked")).toHaveLength(1);
  });

  it("refuse le site d'un autre client, y compris en SQL", async () => {
    const contract = await activeContract();
    const foreign = await createSite(db);
    await expect(linkContractSite(member, contract.id, { siteId: foreign.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      db.insert(s.contractSites).values({
        contractId: contract.id,
        siteId: foreign.id,
        companyId: contract.companyId,
      }),
    ).rejects.toThrow();
  });
});

describe("signature", () => {
  it("enregistre l'état saisi à la main, audité, sans doublon", async () => {
    const contract = await activeContract();
    expect(
      (await updateContractSignature(member, contract.id, { status: "pending" })).signatureStatus,
    ).toBe("pending");
    await updateContractSignature(member, contract.id, { status: "pending" });
    expect(await auditOf(contract.id, "contract.updated")).toHaveLength(1);
    await expect(
      updateContractSignature(member, contract.id, { status: "imaginaire" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("historique", () => {
  it("ajoute une note lisible sur la fiche", async () => {
    const contract = await activeContract();
    await addContractNote(member, contract.id, { note: "Client rappelé" });
    const { events } = await getContractRecord(admin, contract.id);
    expect(events[0]).toMatchObject({ kind: "note", note: "Client rappelé" });
    await expect(addContractNote(member, contract.id, { note: " " })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("journal d'interventions", () => {
  it("planifie, modifie puis réalise", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const site = await createSite(db, { companyId: company.id });
    const person = await createTeamMember(db);
    const planned = await createIntervention(member, contract.id, {
      title: "Mises à jour",
      plannedOn: "2026-11-20",
      siteId: site.id,
      memberId: person.id,
    });
    expect(planned.doneOn).toBeNull();
    expect(await auditOf(planned.id, "intervention.created")).toHaveLength(1);

    const moved = await updateIntervention(member, contract.id, planned.id, {
      title: "Mises à jour mensuelles",
      plannedOn: "2026-11-25",
      siteId: site.id,
      memberId: person.id,
      minutes: "45",
    });
    expect(moved).toMatchObject({ title: "Mises à jour mensuelles", minutes: 45 });

    const done = await completeIntervention(
      member,
      contract.id,
      planned.id,
      { doneOn: TODAY, minutes: "50", result: "Fait" },
      { now: NOW },
    );
    expect(done).toMatchObject({ doneOn: TODAY, minutes: 50, result: "Fait" });
    expect(await auditOf(planned.id, "intervention.done")).toHaveLength(1);
  });

  it("réaliser deux fois ne change rien", async () => {
    const contract = await activeContract();
    const planned = await createIntervention(member, contract.id, {
      title: "X",
      plannedOn: TODAY,
    });
    const input = { doneOn: TODAY, minutes: "30" };
    await completeIntervention(member, contract.id, planned.id, input, { now: NOW });
    const again = await completeIntervention(
      member,
      contract.id,
      planned.id,
      { doneOn: TODAY, minutes: "999" },
      { now: NOW },
    );
    expect(again.minutes).toBe(30);
    expect(await auditOf(planned.id, "intervention.done")).toHaveLength(1);
  });

  it("une intervention réalisée fait preuve", async () => {
    const contract = await activeContract();
    const done = await createIntervention(
      member,
      contract.id,
      { title: "X", doneOn: TODAY, minutes: "10" },
      { now: NOW },
    );
    await expect(
      updateIntervention(member, contract.id, done.id, { title: "Y", plannedOn: TODAY }),
    ).rejects.toThrow(ConflictError);
  });

  it("refuse une date future, une intervention sans date, et le site d'un autre client", async () => {
    const contract = await activeContract();
    await expect(
      createIntervention(member, contract.id, { title: "X", doneOn: "2030-01-01" }, { now: NOW }),
    ).rejects.toThrow(ValidationError);
    await expect(createIntervention(member, contract.id, { title: "X" })).rejects.toThrow(
      ValidationError,
    );
    const foreign = await createSite(db);
    await expect(
      createIntervention(member, contract.id, {
        title: "X",
        plannedOn: TODAY,
        siteId: foreign.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("ne trouve pas l'intervention d'un autre contrat", async () => {
    const contract = await activeContract();
    const other = await activeContract();
    const planned = await createIntervention(member, other.id, { title: "X", plannedOn: TODAY });
    await expect(
      completeIntervention(
        member,
        contract.id,
        planned.id,
        { doneOn: TODAY, minutes: "1" },
        {
          now: NOW,
        },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("clôt le journal d'un contrat terminé et n'en réalise pas un non démarré", async () => {
    const ended = await activeContract({ status: "terminated" });
    await expect(
      createIntervention(member, ended.id, { title: "X", plannedOn: TODAY }),
    ).rejects.toThrow(ConflictError);

    const waiting = await activeContract({ status: "to_start" });
    const planned = await createIntervention(member, waiting.id, {
      title: "Prévue",
      plannedOn: TODAY,
    });
    await expect(
      completeIntervention(
        member,
        waiting.id,
        planned.id,
        { doneOn: TODAY, minutes: "1" },
        {
          now: NOW,
        },
      ),
    ).rejects.toThrow(ConflictError);
    await expect(
      createIntervention(member, waiting.id, { title: "X", doneOn: TODAY }, { now: NOW }),
    ).rejects.toThrow(ConflictError);
  });

  it("pagine sur le serveur, le prévu d'abord", async () => {
    const contract = await activeContract();
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      await createIntervention(
        member,
        contract.id,
        { title: `Faite ${day}`, doneOn: day, minutes: "1" },
        { now: NOW },
      );
    }
    await createIntervention(member, contract.id, { title: "Prévue", plannedOn: "2026-12-01" });
    const first = await listInterventions(admin, contract.id, { page: 1, pageSize: 2 });
    expect(first.total).toBe(4);
    expect(first.items.map((row) => row.title)).toEqual(["Prévue", "Faite 2026-10-03"]);
    const second = await listInterventions(admin, contract.id, { page: 2, pageSize: 2 });
    expect(second.items).toHaveLength(2);
  });
});

describe("consommation du forfait", () => {
  const consume = (contractId: string, minutes: number, ticketId: string | null, now: Date = NOW) =>
    db.transaction((tx) => consumeContractQuota(tx, { contractId, minutes, ticketId, now }));

  async function quotaContract(overrides: Partial<typeof s.contracts.$inferInsert> = {}) {
    const company = await createCompany(db);
    return activeContract({
      companyId: company.id,
      includedMinutes: 100,
      includedTickets: 10,
      ...overrides,
    });
  }

  const usage = async (id: string, now: Date = NOW) =>
    (await getContractRecord(admin, id, { now })).consumption;

  it("impute un ticket une seule fois par période", async () => {
    const contract = await quotaContract();
    const ticket = await createTicket(db, { companyId: contract.companyId });
    await consume(contract.id, 30, ticket.id);
    await consume(contract.id, 30, ticket.id);
    expect(await usage(contract.id)).toMatchObject({ consumedMinutes: 30, consumedTickets: 1 });
    const { total } = await listInterventions(admin, contract.id, PAGE);
    expect(total).toBe(1);
  });

  it("retient le total le plus élevé du ticket, et ignore un total plus bas", async () => {
    const contract = await quotaContract();
    const ticket = await createTicket(db, { companyId: contract.companyId });
    await consume(contract.id, 30, ticket.id);
    await consume(contract.id, 45, ticket.id);
    await consume(contract.id, 10, ticket.id);
    expect(await usage(contract.id)).toMatchObject({ consumedMinutes: 45, consumedTickets: 1 });
  });

  it("recommence à la période suivante, même ticket compris", async () => {
    const contract = await quotaContract();
    const ticket = await createTicket(db, { companyId: contract.companyId });
    await consume(contract.id, 30, ticket.id);
    const later = new Date("2026-12-04T10:00:00Z");
    expect(await usage(contract.id, later)).toMatchObject({ consumedMinutes: 0 });
    await consume(contract.id, 20, ticket.id, later);
    expect(await usage(contract.id, later)).toMatchObject({
      consumedMinutes: 20,
      consumedTickets: 1,
    });
    expect(await usage(contract.id)).toMatchObject({ consumedMinutes: 30 });
  });

  it("réalise l'intervention prévue du ticket au lieu de la dupliquer", async () => {
    const contract = await quotaContract();
    const ticket = await createTicket(db, { companyId: contract.companyId });
    const [planned] = await db
      .insert(s.maintenanceInterventions)
      .values({
        companyId: contract.companyId,
        contractId: contract.id,
        ticketId: ticket.id,
        title: "Correction",
        plannedOn: TODAY,
        minutes: 60,
      })
      .returning();
    expect(await usage(contract.id)).toMatchObject({ consumedMinutes: 0 });
    await consume(contract.id, 25, ticket.id);
    const { items, total } = await listInterventions(admin, contract.id, PAGE);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ id: planned?.id, doneOn: TODAY, minutes: 25 });
  });

  it("additionne les consommations hors ticket, sans compter de demande", async () => {
    const contract = await quotaContract();
    await consume(contract.id, 10, null);
    await consume(contract.id, 10, null);
    expect(await usage(contract.id)).toMatchObject({ consumedMinutes: 20, consumedTickets: 0 });
  });

  it("émet quota_80 une fois par période, à partir de 80 %", async () => {
    const contract = await quotaContract();
    await consume(contract.id, 79, null);
    expect(await domainEventsOf(contract.id, "contract.quota_80")).toHaveLength(0);
    await consume(contract.id, 1, null);
    await consume(contract.id, 5, null);
    const events = await domainEventsOf(contract.id, "contract.quota_80");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      number: contract.number,
      consumedMinutes: 80,
      includedMinutes: 100,
      periodStart: "2026-11-01",
    });
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(0);
  });

  it("émet quota_exceeded une fois par période, strictement au-delà du quota", async () => {
    const contract = await quotaContract();
    await consume(contract.id, 100, null);
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(0);
    await consume(contract.id, 1, null);
    await consume(contract.id, 50, null);
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(1);
    // Un bond direct au-delà du quota émet aussi le seuil de 80 %.
    expect(await domainEventsOf(contract.id, "contract.quota_80")).toHaveLength(1);
  });

  it("réémet à la période suivante", async () => {
    const contract = await quotaContract();
    await consume(contract.id, 150, null);
    await consume(contract.id, 150, null, new Date("2026-12-04T10:00:00Z"));
    expect(await domainEventsOf(contract.id, "contract.quota_80")).toHaveLength(2);
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(2);
  });

  it("alerte aussi sur le quota de demandes", async () => {
    const contract = await quotaContract({ includedMinutes: null, includedTickets: 1 });
    const first = await createTicket(db, { companyId: contract.companyId });
    const second = await createTicket(db, { companyId: contract.companyId });
    await consume(contract.id, 5, first.id);
    expect(await domainEventsOf(contract.id, "contract.quota_80")).toHaveLength(1);
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(0);
    await consume(contract.id, 5, second.id);
    const [event] = await domainEventsOf(contract.id, "contract.quota_exceeded");
    expect(event?.payload).toMatchObject({ consumedTickets: 2, includedTickets: 1 });
  });

  it("n'émet rien sans quota", async () => {
    const contract = await quotaContract({ includedMinutes: null, includedTickets: null });
    await consume(contract.id, 9999, null);
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(0);
    expect(await domainEventsOf(contract.id, "contract.quota_80")).toHaveLength(0);
  });

  it("la réalisation d'une intervention compte et alerte aussi", async () => {
    const contract = await quotaContract();
    const planned = await createIntervention(member, contract.id, {
      title: "Lourde",
      plannedOn: TODAY,
    });
    await completeIntervention(
      member,
      contract.id,
      planned.id,
      { doneOn: TODAY, minutes: "120" },
      { now: NOW },
    );
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(1);
  });

  it("une intervention antidatée compte sur la période de sa date", async () => {
    const contract = await quotaContract();
    await createIntervention(
      member,
      contract.id,
      { title: "Octobre", doneOn: "2026-10-15", minutes: "90" },
      { now: NOW },
    );
    expect(await usage(contract.id)).toMatchObject({ consumedMinutes: 0 });
    const [event] = await domainEventsOf(contract.id, "contract.quota_80");
    expect(event?.payload).toMatchObject({ periodStart: "2026-10-01" });
  });

  it("annule la consommation et ses événements si la transaction échoue", async () => {
    const contract = await quotaContract();
    await expect(
      db.transaction(async (tx) => {
        await consumeContractQuota(tx, {
          contractId: contract.id,
          minutes: 500,
          ticketId: null,
          now: NOW,
        });
        throw new Error("échec de l'opération appelante");
      }),
    ).rejects.toThrow("échec");
    expect(await usage(contract.id)).toMatchObject({ consumedMinutes: 0 });
    expect(await domainEventsOf(contract.id, "contract.quota_exceeded")).toHaveLength(0);
  });

  it("refuse un contrat hors vigueur, un inconnu, une durée invalide, le ticket d'un autre", async () => {
    for (const status of ["to_start", "terminated", "expired"] as const) {
      const contract = await quotaContract({ status });
      await expect(consume(contract.id, 10, null)).rejects.toThrow(ConflictError);
    }
    await expect(consume("00000000-0000-4000-8000-000000000000", 10, null)).rejects.toThrow(
      NotFoundError,
    );
    const contract = await quotaContract();
    await expect(consume(contract.id, -1, null)).rejects.toThrow(ValidationError);
    const foreign = await createTicket(db);
    await expect(consume(contract.id, 10, foreign.id)).rejects.toThrow(NotFoundError);
  });
});

describe("couverture", () => {
  const resolve = (input: Omit<Parameters<typeof resolveCoverage>[1], "now">) =>
    resolveCoverage(db, { ...input, now: NOW });

  it("ne couvre rien sans contrat", async () => {
    const company = await createCompany(db);
    expect(await resolve({ companyId: company.id, category: "bug" })).toMatchObject({
      coverage: "not_covered",
      contractId: null,
      reason: "Aucun contrat pour ce client.",
    });
  });

  it("couvre et donne le reste du quota", async () => {
    const contract = await activeContract({ includedMinutes: 60, includedTickets: 2 });
    const decision = await resolve({ companyId: contract.companyId, category: "bug" });
    expect(decision).toMatchObject({
      coverage: "covered",
      contractId: contract.id,
      includedMinutes: 60,
      consumedMinutes: 0,
      includedTickets: 2,
      consumedTickets: 0,
    });
    expect(decision.reason).toContain(contract.number);
  });

  it("couvre sans quota, avec des quotas nuls dans la réponse", async () => {
    const contract = await activeContract();
    expect(await resolve({ companyId: contract.companyId, category: "bug" })).toMatchObject({
      coverage: "covered",
      includedMinutes: null,
      consumedMinutes: null,
      includedTickets: null,
      consumedTickets: null,
    });
  });

  it("passe hors forfait quand le quota de minutes est atteint", async () => {
    const contract = await activeContract({ includedMinutes: 60 });
    await db.transaction((tx) =>
      consumeContractQuota(tx, { contractId: contract.id, minutes: 60, ticketId: null, now: NOW }),
    );
    const decision = await resolve({ companyId: contract.companyId, category: "bug" });
    expect(decision).toMatchObject({
      coverage: "overage",
      contractId: contract.id,
      consumedMinutes: 60,
    });
    expect(decision.reason).toContain("épuisé");
  });

  it("passe hors forfait quand le quota de demandes est atteint", async () => {
    const contract = await activeContract({ includedTickets: 1 });
    const ticket = await createTicket(db, { companyId: contract.companyId });
    await db.transaction((tx) =>
      consumeContractQuota(tx, {
        contractId: contract.id,
        minutes: 5,
        ticketId: ticket.id,
        now: NOW,
      }),
    );
    expect(await resolve({ companyId: contract.companyId, category: "bug" })).toMatchObject({
      coverage: "overage",
      consumedTickets: 1,
    });
  });

  it("traite un quota de 0 comme hors forfait", async () => {
    const contract = await activeContract({
      kind: "hosting",
      includedMinutes: 0,
      includedTickets: 0,
    });
    expect(await resolve({ companyId: contract.companyId, category: "incident" })).toMatchObject({
      coverage: "overage",
    });
  });

  it("ne couvre pas une évolution, mais garde le contrat pour la transformer", async () => {
    const contract = await activeContract();
    const decision = await resolve({ companyId: contract.companyId, category: "change" });
    expect(decision).toMatchObject({ coverage: "not_covered", contractId: contract.id });
    expect(decision.reason).toContain("demande de changement");
  });

  it("applique le type de contrat", async () => {
    const hosting = await activeContract({ kind: "hosting" });
    expect(await resolve({ companyId: hosting.companyId, category: "bug" })).toMatchObject({
      coverage: "not_covered",
      contractId: hosting.id,
    });
    expect(await resolve({ companyId: hosting.companyId, category: "incident" })).toMatchObject({
      coverage: "covered",
    });
  });

  it.each([
    ["to_start", "n'a pas encore démarré"],
    ["suspended", "est suspendu"],
    ["terminated", "est résilié"],
    ["expired", "a expiré"],
  ] as const)("ne couvre pas un contrat %s", async (status, reason) => {
    const contract = await activeContract({ status });
    const decision = await resolve({ companyId: contract.companyId, category: "bug" });
    expect(decision).toMatchObject({ coverage: "not_covered", contractId: null });
    expect(decision.reason).toContain(reason);
  });

  it("respecte les dates du contrat", async () => {
    const before = await activeContract({ startOn: "2027-01-01" });
    expect((await resolve({ companyId: before.companyId, category: "bug" })).reason).toContain(
      "ne démarre que",
    );
    const after = await activeContract({ endOn: "2026-10-31" });
    expect((await resolve({ companyId: after.companyId, category: "bug" })).reason).toContain(
      "a pris fin",
    );
  });

  it("limite aux sites rattachés, et vaut pour tout le client sans site", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const linked = await createSite(db, { companyId: company.id });
    const other = await createSite(db, { companyId: company.id });

    expect(
      await resolve({ companyId: company.id, siteId: other.id, category: "bug" }),
    ).toMatchObject({ coverage: "covered" });

    await linkContractSite(member, contract.id, { siteId: linked.id });
    expect(
      await resolve({ companyId: company.id, siteId: linked.id, category: "bug" }),
    ).toMatchObject({ coverage: "covered", contractId: contract.id });
    const refused = await resolve({ companyId: company.id, siteId: other.id, category: "bug" });
    expect(refused).toMatchObject({ coverage: "not_covered", contractId: null });
    expect(refused.reason).toContain("ne couvre pas ce site");
  });

  it("préfère le contrat qui nomme le site, et le couvert au hors forfait", async () => {
    const company = await createCompany(db);
    const site = await createSite(db, { companyId: company.id });
    const general = await activeContract({ companyId: company.id });
    const specific = await activeContract({ companyId: company.id });
    await linkContractSite(member, specific.id, { siteId: site.id });
    expect(
      await resolve({ companyId: company.id, siteId: site.id, category: "bug" }),
    ).toMatchObject({ contractId: specific.id });

    await db.update(s.contracts).set({ includedMinutes: 0 }).where(eq(s.contracts.id, specific.id));
    expect(
      await resolve({ companyId: company.id, siteId: site.id, category: "bug" }),
    ).toMatchObject({ coverage: "covered", contractId: general.id });
  });

  it("refuse le contrat d'un autre client sans rien en révéler", async () => {
    const company = await createCompany(db);
    const foreign = await activeContract();
    expect(
      await resolve({ companyId: company.id, contractId: foreign.id, category: "bug" }),
    ).toMatchObject({
      coverage: "not_covered",
      contractId: null,
      reason: "Ce contrat n'appartient pas à ce client.",
      includedMinutes: null,
    });
  });

  it("ignore un contrat archivé", async () => {
    const contract = await activeContract({ archivedAt: new Date() });
    expect(await resolve({ companyId: contract.companyId, category: "bug" })).toMatchObject({
      reason: "Aucun contrat pour ce client.",
    });
  });
});

/** Revenus récurrents : chaque cas tourne sur une base vierge, le total est global. */
describe("revenus récurrents et résumé", () => {
  let isolated: Database;
  let closeIsolated: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    isolated = database.db;
    closeIsolated = database.close;
  });

  afterAll(async () => {
    await closeIsolated();
  });

  it("ramène au mois, compte « À revoir » et rien d'autre", async () => {
    const add = (overrides: Partial<typeof s.contracts.$inferInsert>) =>
      insertContract(isolated, { startOn: "2026-01-01", ...overrides });

    await add({ status: "active", kind: "hosting", priceCents: 4900, period: "monthly" });
    await add({ status: "to_review", kind: "maintenance", priceCents: 30000, period: "quarterly" });
    await add({ status: "active", kind: "support", priceCents: 120000, period: "yearly" });
    // Rien de ce qui suit ne compte.
    await add({ status: "to_start", priceCents: 99900 });
    await add({ status: "suspended", priceCents: 99900 });
    await add({ status: "terminated", priceCents: 99900, terminatedAt: new Date("2026-06-01") });
    await add({ status: "expired", priceCents: 99900, endOn: "2026-06-01" });
    await add({ status: "active", priceCents: 99900, archivedAt: new Date() });
    await add({ status: "active", priceCents: 99900, startOn: "2027-01-01" });
    await add({ status: "active", priceCents: 99900, endOn: "2026-10-31" });

    const revenue = await getRecurringRevenue(isolated, { at: NOW });
    expect(revenue.on).toBe(TODAY);
    expect(revenue.mrrCents).toBe(4900 + 10000 + 10000);
    expect(revenue.arrCents).toBe((4900 + 10000 + 10000) * 12);
    expect(revenue.activeCount).toBe(3);
    expect(revenue.byKind.hosting).toEqual({ count: 1, mrrCents: 4900 });
    expect(revenue.byKind.maintenance).toEqual({ count: 1, mrrCents: 10000 });
    expect(revenue.byKind.support).toEqual({ count: 1, mrrCents: 10000 });
    expect(revenue.byKind.accompaniment).toEqual({ count: 0, mrrCents: 0 });
  });

  it("arrondit sur la somme, une seule fois", async () => {
    const database = await createTestDatabase();
    const add = () =>
      insertContract(database.db, {
        status: "active",
        startOn: "2026-01-01",
        priceCents: 100,
        period: "quarterly",
      });
    await add();
    await add();
    await add();
    expect((await getRecurringRevenue(database.db, { at: NOW })).mrrCents).toBe(100);
    await database.close();
  });

  it("retrouve le passé : prix d'alors, contrat pas encore démarré, résilié depuis", async () => {
    const database = await createTestDatabase();
    const local = database.db;
    const repriced = await insertContract(local, {
      status: "active",
      startOn: "2026-01-01",
      priceCents: 12900,
    });
    await local.insert(s.contractEvents).values({
      contractId: repriced.id,
      kind: "price_change",
      fromPriceCents: 9900,
      toPriceCents: 12900,
      at: new Date("2026-09-01T00:00:00Z"),
    });
    await insertContract(local, {
      status: "active",
      startOn: "2026-10-01",
      priceCents: 1000,
    });
    await insertContract(local, {
      status: "terminated",
      startOn: "2026-01-01",
      priceCents: 500,
      endOn: "2026-10-15",
      terminatedAt: new Date("2026-10-15T12:00:00Z"),
    });
    const suspended = await insertContract(local, {
      status: "suspended",
      startOn: "2026-01-01",
      priceCents: 300,
    });
    await local.insert(s.contractEvents).values({
      contractId: suspended.id,
      kind: "suspended",
      at: new Date("2026-10-20T00:00:00Z"),
    });

    const inAugust = await getRecurringRevenue(local, { at: new Date("2026-08-15T12:00:00Z") });
    expect(inAugust.mrrCents).toBe(9900 + 500 + 300);
    const inOctober = await getRecurringRevenue(local, { at: new Date("2026-10-10T12:00:00Z") });
    expect(inOctober.mrrCents).toBe(12900 + 1000 + 500 + 300);
    const today = await getRecurringRevenue(local, { at: NOW });
    expect(today.mrrCents).toBe(12900 + 1000);
    await database.close();
  });

  it("résume l'écran 20 et la liste des échéances", async () => {
    const database = await createTestDatabase();
    const local = database.db;
    const company = await createCompany(local, { name: "Bistrot" });
    const due = await insertContract(local, {
      companyId: company.id,
      status: "to_review",
      kind: "accompaniment",
      startOn: "2026-06-01",
      renewsOn: "2026-12-01",
      priceCents: 130000,
      includedMinutes: 100,
    });
    await insertContract(local, {
      status: "active",
      kind: "hosting",
      startOn: "2026-06-01",
      renewsOn: "2027-06-01",
      priceCents: 4900,
      includedMinutes: 100,
    });
    await insertContract(local, { status: "to_start", kind: "hosting", priceCents: 4900 });
    const late = await insertContract(local, {
      status: "active",
      kind: "hosting",
      startOn: "2026-01-01",
      renewsOn: "2026-10-01",
      priceCents: 1000,
    });
    await local.transaction((tx) =>
      consumeContractQuota(tx, { contractId: due.id, minutes: 50, ticketId: null, now: NOW }),
    );

    const summary = await getContractsSummary(local, { now: NOW });
    expect(summary).toMatchObject({
      today: TODAY,
      activeCount: 3,
      activeByKind: { hosting: 2, accompaniment: 1, maintenance: 0, support: 0 },
      mrrCents: 135900,
      arrCents: 135900 * 12,
      dueForRenewalCount: 2,
      toStartCount: 1,
      toReviewCount: 1,
      averageQuotaPercent: 25,
    });
    expect(summary.nextDue?.contractId).toBe(late.id);

    const list = await listContractsDueForRenewal(local, NOW);
    expect(list.map((row) => row.contractId)).toEqual([late.id, due.id]);
    expect(
      (await listContractsDueForRenewal(local, NOW, { withinDays: 365 })).map(
        (row) => row.contractId,
      ),
    ).toHaveLength(3);
    await database.close();
  });

  it("donne un résumé vide sans contrat, et une moyenne non calculable", async () => {
    const database = await createTestDatabase();
    const summary = await getContractsSummary(database.db, { now: NOW });
    expect(summary).toMatchObject({
      activeCount: 0,
      mrrCents: 0,
      dueForRenewalCount: 0,
      nextDue: null,
      averageQuotaPercent: null,
    });
    await database.close();
  });
});

describe("liste et vues", () => {
  it("pagine, filtre, cherche et trie sur le serveur", async () => {
    const database = await createTestDatabase();
    const local = database.db;
    const ctx = await createTestContext(local, "admin");
    const alpha = await createCompany(local, { name: "Alpha" });
    const beta = await createCompany(local, { name: "Beta" });
    await insertContract(local, {
      companyId: alpha.id,
      status: "active",
      priceCents: 100,
      renewsOn: "2027-01-01",
      name: "Contrat A",
    });
    await insertContract(local, {
      companyId: beta.id,
      status: "to_review",
      priceCents: 300,
      renewsOn: "2026-12-01",
      kind: "hosting",
    });
    await insertContract(local, {
      companyId: beta.id,
      status: "terminated",
      priceCents: 200,
    });

    const open = await listContracts(ctx, {}, PAGE);
    expect(open.total).toBe(2);
    expect(open.items.map((row) => row.priceCents)).toEqual([300, 100]);

    expect((await listContracts(ctx, { filter: "all" }, PAGE)).total).toBe(3);
    expect((await listContracts(ctx, { filter: "ended" }, PAGE)).total).toBe(1);
    expect((await listContracts(ctx, { filter: "to_review" }, PAGE)).total).toBe(1);
    expect((await listContracts(ctx, { kind: "hosting" }, PAGE)).total).toBe(1);
    expect((await listContracts(ctx, { search: "alph" }, PAGE)).total).toBe(1);
    expect((await listContracts(ctx, { search: "contrat a" }, PAGE)).total).toBe(1);
    // Un caractère joker de LIKE se cherche littéralement.
    expect((await listContracts(ctx, { search: "%" }, PAGE)).total).toBe(0);

    const byPrice = await listContracts(ctx, { sort: "price", direction: "desc" }, PAGE);
    expect(byPrice.items.map((row) => row.priceCents)).toEqual([300, 100]);
    const paged = await listContracts(ctx, {}, { page: 2, pageSize: 1 });
    expect(paged).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(paged.items).toHaveLength(1);

    // Une URL trafiquée revient aux valeurs par défaut au lieu d'échouer.
    expect((await listContracts(ctx, { filter: "x", sort: "y", kind: "z" }, PAGE)).total).toBe(2);
    await database.close();
  });

  it("signale un contrat à démarrer qui attend une mise en ligne", async () => {
    const company = await createCompany(db);
    const contract = await insertContract(db, { companyId: company.id, status: "to_start" });
    const site = await createSite(db, { companyId: company.id, status: "staging" });
    await linkContractSite(member, contract.id, { siteId: site.id });
    expect((await getContractRecord(admin, contract.id)).contract.awaitsGoLive).toBe(true);
  });

  it("résume les contrats d'un client pour sa fiche, limite comprise", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id, includedMinutes: 60 });
    await activeContract({ companyId: company.id });
    await activeContract();
    await db.transaction((tx) =>
      consumeContractQuota(tx, { contractId: contract.id, minutes: 15, ticketId: null, now: NOW }),
    );
    const rows = await listContractsForCompany(viewer, company.id, { now: NOW });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === contract.id)).toMatchObject({
      includedMinutes: 60,
      consumedMinutes: 15,
    });
    expect(await listContractsForCompany(viewer, company.id, { limit: 1 })).toHaveLength(1);
  });

  it("alimente l'écran 20 avec les panneaux", async () => {
    const database = await createTestDatabase();
    const local = database.db;
    const ctx = await createTestContext(local, "viewer");
    const contract = await insertContract(local, {
      status: "active",
      startOn: "2025-01-01",
      renewsOn: "2026-11-20",
      includedMinutes: 100,
    });
    await local.transaction((tx) =>
      consumeContractQuota(tx, { contractId: contract.id, minutes: 40, ticketId: null, now: NOW }),
    );
    const overview = await getContractsOverview(ctx, { now: NOW });
    expect(overview.quotas[0]).toMatchObject({ contractId: contract.id, percent: 40 });
    expect(overview.recentInterventions).toHaveLength(1);
    expect(overview.renewals[0]?.contractId).toBe(contract.id);
    expect(overview.priceReviews[0]).toMatchObject({
      contractId: contract.id,
      reviewOn: "2026-01-01",
    });
    await database.close();
  });
});

describe("formules", () => {
  it("crée, modifie, retire ; un retrait ne touche pas les contrats", async () => {
    const plan = await createMaintenancePlan(member, {
      name: "Formule cycle",
      priceCents: "5000",
      period: "monthly",
    });
    expect(await auditOf(plan.id, "maintenance_plan.created")).toHaveLength(1);
    const updated = await updateMaintenancePlan(member, plan.id, {
      name: "Formule cycle 2",
      priceCents: "6000",
      period: "yearly",
      includedMinutes: "60",
    });
    expect(updated).toMatchObject({ priceCents: 6000, period: "yearly", includedMinutes: 60 });

    const company = await createCompany(db);
    const contract = await createContract(member, validInput(company.id, { planId: plan.id }));
    await setMaintenancePlanActive(member, plan.id, false);
    await setMaintenancePlanActive(member, plan.id, false);
    expect(
      (await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, plan.id))).filter(
        (row) => row.action === "maintenance_plan.updated",
      ),
    ).toHaveLength(2);
    const [row] = await db.select().from(s.contracts).where(eq(s.contracts.id, contract.id));
    expect(row?.planId).toBe(plan.id);

    const listed = await listMaintenancePlans(viewer);
    expect(listed.find((item) => item.id === plan.id)).toMatchObject({
      active: false,
      contractCount: 1,
    });
    expect(
      (await listMaintenancePlans(viewer, { activeOnly: true })).map((item) => item.id),
    ).not.toContain(plan.id);
  });

  it("refuse un nom déjà pris et une formule inconnue", async () => {
    const input = { name: "Formule unique", priceCents: "1", period: "monthly" };
    await createMaintenancePlan(member, input);
    await expect(createMaintenancePlan(member, input)).rejects.toThrow(ConflictError);
    await expect(
      updateMaintenancePlan(member, "00000000-0000-4000-8000-000000000000", input),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("mise en ligne d'un site", () => {
  it("démarre ses contrats à démarrer, une seule fois", async () => {
    const company = await createCompany(db);
    const site = await createSite(db, { companyId: company.id });
    const contract = await insertContract(db, {
      companyId: company.id,
      status: "to_start",
      autoRenew: true,
    });
    const running = await activeContract({ companyId: company.id, startOn: "2026-01-01" });
    await linkContractSite(member, contract.id, { siteId: site.id });
    await linkContractSite(member, running.id, { siteId: site.id });

    const go = () =>
      db.transaction((tx) =>
        activateContractsForSite(tx, { siteId: site.id, actorId: null, now: NOW }),
      );
    await go();
    await go();

    const [row] = await db.select().from(s.contracts).where(eq(s.contracts.id, contract.id));
    expect(row).toMatchObject({ status: "active", startOn: TODAY, renewsOn: "2026-12-04" });
    expect(await eventsOf(contract.id)).toHaveLength(1);
    expect(await eventsOf(running.id)).toHaveLength(0);
  });
});

describe("tâche des échéances", () => {
  it("renouvelle, fait expirer, alerte, et ne répète rien", async () => {
    const database = await createTestDatabase();
    const local = database.db;
    const auto = await insertContract(local, {
      status: "active",
      startOn: "2026-01-01",
      renewsOn: "2026-09-15",
      autoRenew: true,
      period: "monthly",
    });
    const ended = await insertContract(local, {
      status: "active",
      startOn: "2026-01-01",
      endOn: "2026-11-01",
    });
    const soon = await insertContract(local, {
      status: "active",
      startOn: "2026-01-01",
      renewsOn: "2026-11-20",
    });
    const far = await insertContract(local, {
      status: "active",
      startOn: "2026-01-01",
      renewsOn: "2027-06-01",
    });
    const reviewed = await insertContract(local, {
      status: "to_review",
      startOn: "2026-01-01",
      endOn: "2026-11-01",
    });

    const first = await runContractDeadlines(local, { now: NOW });
    expect(first).toEqual({ renewed: 2, expired: 1, alerted: 2, failed: 0 });

    const read = async (id: string) =>
      (await local.select().from(s.contracts).where(eq(s.contracts.id, id)))[0];
    // Deux échéances manquées (15/09, 15/10) : le contrat revient à la première date à venir.
    expect((await read(auto.id))?.renewsOn).toBe("2026-11-15");
    expect((await read(ended.id))?.status).toBe("expired");
    expect((await read(far.id))?.status).toBe("active");
    // La machine n'autorise pas to_review → expired : il reste à traiter, et l'alerte part.
    expect((await read(reviewed.id))?.status).toBe("to_review");

    const events = await local
      .select()
      .from(s.domainEvents)
      .where(eq(s.domainEvents.type, "contract.expiring"));
    expect(events.map((row) => row.entityId).sort()).toEqual([soon.id, reviewed.id].sort());
    expect(
      (await local.select().from(s.contractEvents).where(eq(s.contractEvents.contractId, auto.id)))
        .length,
    ).toBe(2);

    const second = await runContractDeadlines(local, { now: NOW });
    expect(second.renewed).toBe(0);
    expect(second.expired).toBe(0);
    expect(
      await local.select().from(s.domainEvents).where(eq(s.domainEvents.type, "contract.expiring")),
    ).toHaveLength(2);
    await database.close();
  });
});

describe("travail hors forfait", () => {
  it("devient une demande de changement, une seule fois", async () => {
    const contract = await activeContract();
    const input = { title: "Nouvelle page tarifs", estimatedMinutes: "120", amountCents: "30000" };
    const first = await convertOverage(admin, contract.id, input);
    expect(first.quoteId).toBeNull();
    const rows = await db
      .select()
      .from(s.changeRequests)
      .where(eq(s.changeRequests.id, first.changeRequestId));
    expect(rows[0]).toMatchObject({
      companyId: contract.companyId,
      title: "Nouvelle page tarifs",
      estimatedMinutes: 120,
      amountCents: 30000,
    });

    const again = await convertOverage(admin, contract.id, {
      ...input,
      title: "NOUVELLE PAGE TARIFS",
    });
    expect(again.changeRequestId).toBe(first.changeRequestId);
    const notes = (await eventsOf(contract.id)).filter((row) => row.kind === "note");
    expect(notes).toHaveLength(1);
  });

  it("peut donner un devis brouillon, relié à la demande et sans doublon", async () => {
    const contract = await activeContract();
    const input = { title: "Module de réservation", withQuote: "on" };
    const first = await convertOverage(admin, contract.id, input);
    expect(first.quoteId).toBeTruthy();
    const [quote] = await db
      .select()
      .from(s.quotes)
      .where(eq(s.quotes.id, first.quoteId as string));
    expect(quote).toMatchObject({ companyId: contract.companyId, status: "draft" });

    const again = await convertOverage(admin, contract.id, input);
    expect(again).toEqual(first);
  });

  it("est refusé en lecture seule, hors droits et sur un contrat terminé", async () => {
    const contract = await activeContract();
    for (const ctx of [viewer, contractor, client]) {
      await expect(convertOverage(ctx, contract.id, { title: "Essai" })).rejects.toThrow(
        ForbiddenError,
      );
    }
    const ended = await activeContract({ status: "terminated" });
    await expect(convertOverage(admin, ended.id, { title: "Essai" })).rejects.toThrow(
      ConflictError,
    );
    await expect(convertOverage(admin, contract.id, { title: " " })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("fiche de contrat", () => {
  it("répond 404 pour une adresse illisible, sans erreur de la base", async () => {
    await expect(getContractRecord(admin, "pas-un-id")).rejects.toThrow(NotFoundError);
    await expect(assertContractReadable(admin, "pas-un-id")).rejects.toThrow(NotFoundError);
  });

  it("vérifie le droit avant l'existence", async () => {
    const contract = await activeContract();
    await expect(assertContractReadable(viewer, contract.id)).resolves.toBeUndefined();
    await expect(assertContractReadable(contractor, contract.id)).rejects.toThrow(ForbiddenError);
    await expect(assertContractReadable(client, contract.id)).rejects.toThrow(ForbiddenError);
    await expect(
      assertContractReadable(admin, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });

  it("donne la couverture de chaque catégorie, avec sa raison", async () => {
    const contract = await activeContract({ kind: "maintenance", includedMinutes: 60 });
    const { coverage } = await getContractRecord(admin, contract.id, { now: NOW });
    const decisionOf = (category: string) =>
      coverage.find((row) => row.category === category)?.decision;
    expect(coverage).toHaveLength(5);
    expect(decisionOf("incident")?.coverage).toBe("covered");
    expect(decisionOf("change")?.coverage).toBe("not_covered");
    expect(decisionOf("change")?.reason).toContain(contract.number);

    await consumeContractQuota(db, {
      contractId: contract.id,
      minutes: 60,
      ticketId: null,
      now: NOW,
    });
    const after = await getContractRecord(admin, contract.id, { now: NOW });
    expect(after.coverage.find((row) => row.category === "incident")?.decision.coverage).toBe(
      "overage",
    );
  });

  it("indique un contrat à démarrer qui attend la mise en ligne de son site", async () => {
    const companyId = (await createCompany(db)).id;
    const site = await createSite(db, { companyId, status: "staging" });
    const contract = await activeContract({ companyId, status: "to_start" });
    await linkContractSite(admin, contract.id, { siteId: site.id });
    const { contract: detail } = await getContractRecord(admin, contract.id, { now: NOW });
    expect(detail.awaitsGoLive).toBe(true);
    expect(detail.nextDueOn).toBeNull();
  });
});

describe("marge indisponible", () => {
  it("n'échoue pas et ne montre aucun zéro si le calcul n'est pas disponible", async () => {
    const contract = await activeContract();
    expect((await getContractRecord(member, contract.id)).margin).toBeNull();
    await expect(getContractRecord(admin, contract.id)).resolves.toBeTruthy();
  });
});
