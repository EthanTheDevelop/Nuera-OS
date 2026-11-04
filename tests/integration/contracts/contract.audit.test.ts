import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateContractsForSite,
  addContractNote,
  archiveContract,
  changeContractPrice,
  changeContractStatus,
  convertOverage,
  createContract,
  getContractFormOptions,
  getContractRecord,
  linkContractSite,
  listContracts,
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
const NOT_AN_ID = "pas-un-uuid";

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

const rowOf = async (id: string) => {
  const [row] = await db.select().from(s.contracts).where(eq(s.contracts.id, id));
  if (!row) throw new Error("contrat absent");
  return row;
};

const eventsOf = (id: string) =>
  db.select().from(s.contractEvents).where(eq(s.contractEvents.contractId, id));

const editInput = (contract: s.Contract, overrides: Record<string, unknown> = {}) => ({
  name: contract.name,
  kind: contract.kind,
  period: contract.period,
  planId: contract.planId,
  quoteId: contract.quoteId,
  startOn: contract.startOn,
  endOn: contract.endOn,
  renewsOn: contract.renewsOn,
  autoRenew: contract.autoRenew,
  monthlyCostCents: contract.monthlyCostCents,
  includedMinutes: contract.includedMinutes,
  includedTickets: contract.includedTickets,
  scope: contract.scope,
  exclusions: contract.exclusions,
  conditions: contract.conditions,
  responseHours: contract.responseHours,
  resolutionHours: contract.resolutionHours,
  ...overrides,
});

describe("autorisations : chaque écriture, par rôle", () => {
  const writes: [string, (ctx: ServiceContext, contract: s.Contract) => Promise<unknown>][] = [
    ["créer", (ctx) => createContract(ctx, {})],
    ["modifier", (ctx, c) => updateContract(ctx, c.id, {})],
    ["réviser le tarif", (ctx, c) => changeContractPrice(ctx, c.id, {})],
    ["renouveler", (ctx, c) => renewContract(ctx, c.id, {})],
    ["changer d'état", (ctx, c) => changeContractStatus(ctx, c.id, {})],
    ["résilier", (ctx, c) => terminateContract(ctx, c.id, {})],
    ["archiver", (ctx, c) => archiveContract(ctx, c.id)],
    ["noter", (ctx, c) => addContractNote(ctx, c.id, {})],
    ["saisir la signature", (ctx, c) => updateContractSignature(ctx, c.id, {})],
    ["rattacher un site", (ctx, c) => linkContractSite(ctx, c.id, {})],
    ["retirer un site", (ctx, c) => unlinkContractSite(ctx, c.id, {})],
    ["transformer du hors forfait", (ctx, c) => convertOverage(ctx, c.id, {})],
    ["planifier", (ctx, c) => createIntervention(ctx, c.id, {})],
    ["modifier une intervention", (ctx, c) => updateIntervention(ctx, c.id, c.id, {})],
    ["réaliser une intervention", (ctx, c) => completeIntervention(ctx, c.id, c.id, {})],
    ["créer une formule", (ctx) => createMaintenancePlan(ctx, {})],
    ["modifier une formule", (ctx, c) => updateMaintenancePlan(ctx, c.id, {})],
    ["retirer une formule", (ctx, c) => setMaintenancePlanActive(ctx, c.id, false)],
  ];

  it.each(writes)("%s : refusé au lecteur, au prestataire et au client", async (_, write) => {
    const contract = await activeContract();
    const before = await rowOf(contract.id);
    for (const ctx of [viewer, contractor, client]) {
      await expect(write(ctx, contract)).rejects.toThrow(ForbiddenError);
    }
    expect(await rowOf(contract.id)).toEqual(before);
  });

  it("ne laisse ni le formulaire ni la fiche du lecteur porter un coût", async () => {
    const contract = await activeContract({ monthlyCostCents: 700 });
    const record = await getContractRecord(viewer, contract.id);
    expect(JSON.stringify(record)).not.toContain('"monthlyCostCents":700');
    await expect(getContractFormOptions(viewer)).rejects.toThrow(ForbiddenError);
  });
});

describe("adresses illisibles : un 404, jamais une erreur de la base", () => {
  it.each<[string, () => Promise<unknown>]>([
    [
      "modifier",
      () => updateContract(admin, NOT_AN_ID, { name: "x", kind: "support", period: "monthly" }),
    ],
    ["réviser", () => changeContractPrice(admin, NOT_AN_ID, { priceCents: 1, period: "monthly" })],
    ["résilier", () => terminateContract(admin, NOT_AN_ID, { note: "x" })],
    ["archiver", () => archiveContract(admin, NOT_AN_ID)],
    ["noter", () => addContractNote(admin, NOT_AN_ID, { note: "x" })],
    [
      "planifier",
      () => createIntervention(admin, NOT_AN_ID, { title: "x", plannedOn: "2026-12-01" }),
    ],
    ["lister le journal", () => listInterventions(admin, NOT_AN_ID, PAGE)],
    ["retirer une formule", () => setMaintenancePlanActive(admin, NOT_AN_ID, false)],
    [
      "modifier une formule",
      () =>
        updateMaintenancePlan(admin, NOT_AN_ID, { name: "x", priceCents: 1, period: "monthly" }),
    ],
  ])("%s", async (_, operation) => {
    await expect(operation()).rejects.toThrow(NotFoundError);
  });

  it("une intervention illisible d'un contrat réel répond aussi 404", async () => {
    const contract = await activeContract();
    await expect(
      completeIntervention(admin, contract.id, NOT_AN_ID, { doneOn: "2026-11-01", minutes: 5 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("les lectures 360° ne plantent pas sur un identifiant illisible", async () => {
    await expect(listContractsForCompany(admin, NOT_AN_ID)).resolves.toEqual([]);
    await expect(listContractsForSite(admin, NOT_AN_ID)).resolves.toEqual([]);
  });
});

describe("site rattaché depuis sa fiche (sites.contract_id)", () => {
  async function viaSite() {
    const company = await createCompany(db);
    const contract = await insertContract(db, { companyId: company.id, status: "to_start" });
    const site = await createSite(db, {
      companyId: company.id,
      contractId: contract.id,
      status: "staging",
    });
    return { company, contract, site };
  }

  it("apparaît sur la fiche du contrat et ne se retire pas d'ici", async () => {
    const { contract, site } = await viaSite();
    const { sites, impact } = await getContractRecord(admin, contract.id);
    expect(sites.map((row) => row.siteId)).toEqual([site.id]);
    expect(sites[0]?.removable).toBe(false);
    expect(impact.sites.map((row) => row.siteId)).toEqual([site.id]);
    await expect(unlinkContractSite(admin, contract.id, { siteId: site.id })).rejects.toThrow(
      ConflictError,
    );
  });

  it("un site rattaché ici reste retirable, une seule fois dans la liste", async () => {
    const { company, contract, site } = await viaSite();
    const other = await createSite(db, { companyId: company.id });
    await linkContractSite(admin, contract.id, { siteId: other.id });
    await linkContractSite(admin, contract.id, { siteId: site.id });
    const { sites } = await getContractRecord(admin, contract.id);
    expect(sites.map((row) => row.siteId).sort()).toEqual([site.id, other.id].sort());
    expect(sites.find((row) => row.siteId === other.id)?.removable).toBe(true);
    expect(sites.find((row) => row.siteId === site.id)?.removable).toBe(false);
  });

  it("limite la couverture à ce site", async () => {
    const { company, contract, site } = await viaSite();
    await changeContractStatus(admin, contract.id, { status: "active" }, { now: NOW });
    const elsewhere = await createSite(db, { companyId: company.id });
    const covered = await resolveCoverage(db, {
      companyId: company.id,
      siteId: site.id,
      category: "incident",
      now: NOW,
    });
    const notCovered = await resolveCoverage(db, {
      companyId: company.id,
      siteId: elsewhere.id,
      category: "incident",
      now: NOW,
    });
    expect(covered.coverage).toBe("covered");
    expect(notCovered.coverage).toBe("not_covered");
  });

  it("démarre le contrat à la mise en ligne et figure dans les contrats du site", async () => {
    const { contract, site } = await viaSite();
    expect((await listContractsForSite(admin, site.id)).map((row) => row.id)).toEqual([
      contract.id,
    ]);
    const { contract: detail } = await getContractRecord(admin, contract.id);
    expect(detail.awaitsGoLive).toBe(true);
    await db.transaction((tx) =>
      activateContractsForSite(tx, { siteId: site.id, actorId: null, now: NOW }),
    );
    expect((await rowOf(contract.id)).status).toBe("active");
  });

  it("figure dans les contrats du portail", async () => {
    const portal = await createPortalTestContext(db);
    const contract = await activeContract({ companyId: portal.companyId });
    const site = await createSite(db, { companyId: portal.companyId, contractId: contract.id });
    const rows = await listContractsForPortal(portal, { now: NOW });
    const mine = rows.find((row) => row.id === contract.id);
    expect(mine?.sites.map((row) => row.siteId)).toEqual([site.id]);
  });
});

describe("objets archivés", () => {
  it("n'accepte ni un site archivé ni un intervenant archivé", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const site = await createSite(db, { companyId: company.id, archivedAt: new Date() });
    await expect(linkContractSite(admin, contract.id, { siteId: site.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      createIntervention(admin, contract.id, {
        title: "Sur un site archivé",
        plannedOn: "2026-12-01",
        siteId: site.id,
      }),
    ).rejects.toThrow(NotFoundError);
    const gone = await createTeamMember(db, { archivedAt: new Date() });
    await expect(
      createIntervention(admin, contract.id, {
        title: "Par un intervenant archivé",
        plannedOn: "2026-12-01",
        memberId: gone.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("n'affiche pas un site archivé après coup", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const site = await createSite(db, { companyId: company.id });
    await linkContractSite(admin, contract.id, { siteId: site.id });
    await db.update(s.sites).set({ archivedAt: new Date() }).where(eq(s.sites.id, site.id));
    expect((await getContractRecord(admin, contract.id)).sites).toEqual([]);
  });
});

describe("historique du contrat (08.02.03)", () => {
  it("note ce qui a changé à la modification, sans parler du coût", async () => {
    const contract = await activeContract({ scope: "Avant", monthlyCostCents: 100 });
    await updateContract(
      admin,
      contract.id,
      editInput(contract, { scope: "Après", endOn: "2027-06-30", monthlyCostCents: "200" }),
    );
    const events = await eventsOf(contract.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("note");
    expect(events[0]?.note).toContain("périmètre");
    expect(events[0]?.note).toContain("fin");
    expect(events[0]?.note).not.toContain("coût");
  });

  it("un enregistrement sans changement n'écrit rien", async () => {
    const contract = await activeContract({ scope: "Stable" });
    await updateContract(admin, contract.id, editInput(contract));
    expect(await eventsOf(contract.id)).toHaveLength(0);
    const audits = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, contract.id), eq(s.auditLog.action, "contract.updated")));
    expect(audits).toHaveLength(0);
  });

  it("dit d'où à où va un renouvellement", async () => {
    const contract = await activeContract({ renewsOn: "2026-11-29" });
    await renewContract(admin, contract.id, { expectedNextOn: "2026-11-29", note: "Accord oral" });
    const [event] = await eventsOf(contract.id);
    expect(event?.kind).toBe("renewed");
    expect(event?.note).toContain("29/11/2026");
    expect(event?.note).toContain("29/12/2026");
    expect(event?.note).toContain("Accord oral");
  });

  it("garde la signature saisie à la main", async () => {
    const contract = await activeContract();
    await updateContractSignature(admin, contract.id, { status: "signed" });
    await updateContractSignature(admin, contract.id, { status: "signed" });
    const events = await eventsOf(contract.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.note).toContain("Signé");
  });

  it("montre un changement de périodicité à prix constant", async () => {
    const contract = await activeContract({ priceCents: 12000, period: "monthly" });
    await changeContractPrice(admin, contract.id, { priceCents: 12000, period: "yearly" });
    const [event] = await eventsOf(contract.id);
    expect(event?.note).toContain("mensuel");
    expect(event?.note).toContain("annuel");
  });
});

describe("rejeux", () => {
  it("consigner deux fois la même intervention ne consomme qu'une fois", async () => {
    const contract = await activeContract({ includedMinutes: 100 });
    const input = { title: "Mise à jour", doneOn: "2026-11-02", minutes: "60" };
    const first = await createIntervention(member, contract.id, input, { now: NOW });
    const second = await createIntervention(member, contract.id, input, { now: NOW });
    expect(second.id).toBe(first.id);
    const { consumption } = await getContractRecord(admin, contract.id, { now: NOW });
    expect(consumption.consumedMinutes).toBe(60);
  });

  it("refuse une réalisation datée d'avant le début du contrat, qu'aucune période ne compterait", async () => {
    const contract = await activeContract({ startOn: "2026-11-03", includedMinutes: 100 });
    await expect(
      createIntervention(
        member,
        contract.id,
        { title: "Trop tôt", doneOn: "2026-11-02", minutes: "60" },
        { now: NOW },
      ),
    ).rejects.toThrow(ValidationError);
    const planned = await createIntervention(
      member,
      contract.id,
      { title: "Prévue", plannedOn: "2026-11-10" },
      { now: NOW },
    );
    await expect(
      completeIntervention(
        member,
        contract.id,
        planned.id,
        { doneOn: "2026-11-02", minutes: "60" },
        { now: NOW },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("deux interventions différentes le même jour restent deux", async () => {
    const contract = await activeContract({ includedMinutes: 100 });
    const a = await createIntervention(
      member,
      contract.id,
      { title: "A", doneOn: "2026-11-02", minutes: "10" },
      { now: NOW },
    );
    const b = await createIntervention(
      member,
      contract.id,
      { title: "B", doneOn: "2026-11-02", minutes: "10" },
      { now: NOW },
    );
    expect(a.id).not.toBe(b.id);
  });

  it("le hors forfait est atomique : un devis en échec ne laisse pas de demande", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    await db.execute(sql`
      create function refuse_quote() returns trigger language plpgsql as $$
      begin raise exception 'devis refusé'; end $$;
    `);
    await db.execute(sql`
      create trigger refuse_quote_trigger before insert on quotes
      for each row when (new.title = 'Devis impossible') execute function refuse_quote();
    `);
    try {
      await expect(
        convertOverage(admin, contract.id, { title: "Devis impossible", withQuote: "on" }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger refuse_quote_trigger on quotes`);
      await db.execute(sql`drop function refuse_quote`);
    }
    const left = await db
      .select()
      .from(s.changeRequests)
      .where(eq(s.changeRequests.companyId, company.id));
    expect(left).toHaveLength(0);
    expect(await eventsOf(contract.id)).toHaveLength(0);
  });

  it("retrouve une demande de même titre au-delà des 100 dernières", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const first = await convertOverage(admin, contract.id, { title: "Ancienne demande" });
    await db.insert(s.changeRequests).values(
      Array.from({ length: 101 }, (_, index) => ({
        companyId: company.id,
        title: `Autre ${index}`,
        createdAt: new Date(Date.now() + index + 1000),
      })),
    );
    const again = await convertOverage(admin, contract.id, { title: "ancienne demande" });
    expect(again.changeRequestId).toBe(first.changeRequestId);
  });
});

describe("dates", () => {
  it("refuse un renouvellement après la fin", async () => {
    const company = await createCompany(db);
    await expect(
      createContract(admin, {
        companyId: company.id,
        name: "Dates incohérentes",
        kind: "support",
        period: "monthly",
        priceCents: "100",
        endOn: "2027-01-01",
        renewsOn: "2027-06-01",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("une fin proche déclenche l'alerte puis l'expiration, même avec une date de renouvellement lointaine", async () => {
    // Ligne antérieure à la règle : la fin passe avant le renouvellement.
    const contract = await activeContract({ endOn: "2026-11-20", renewsOn: "2027-06-01" });
    const before = await runContractDeadlines(db, { now: NOW });
    expect(before.alerted).toBeGreaterThanOrEqual(1);
    const alerts = await db
      .select()
      .from(s.domainEvents)
      .where(
        and(eq(s.domainEvents.entityId, contract.id), eq(s.domainEvents.type, "contract.expiring")),
      );
    expect(alerts).toHaveLength(1);
    await runContractDeadlines(db, { now: new Date("2026-11-21T10:00:00Z") });
    expect((await rowOf(contract.id)).status).toBe("expired");
  });

  it("donne une échéance à un contrat en cours passé en renouvellement automatique", async () => {
    const contract = await activeContract({ startOn: "2026-01-15", autoRenew: false });
    await updateContract(admin, contract.id, editInput(contract, { autoRenew: "on" }), {
      now: NOW,
    });
    const row = await rowOf(contract.id);
    expect(row.autoRenew).toBe(true);
    expect(row.renewsOn).toBe("2026-11-15");
  });

  it("au démarrage, l'échéance automatique ne dépasse pas la fin", async () => {
    const contract = await insertContract(db, {
      status: "to_start",
      startOn: "2026-11-01",
      endOn: "2026-11-20",
      period: "yearly",
      autoRenew: true,
    });
    await changeContractStatus(admin, contract.id, { status: "active" }, { now: NOW });
    expect((await rowOf(contract.id)).renewsOn).toBe("2026-11-20");
  });

  it("un renouvellement à une date choisie garde la fin au moins jusque-là", async () => {
    const contract = await activeContract({ renewsOn: "2026-11-29", endOn: "2026-11-30" });
    await renewContract(admin, contract.id, {
      expectedNextOn: "2026-11-29",
      newRenewsOn: "2027-03-01",
    });
    const row = await rowOf(contract.id);
    expect(row.renewsOn).toBe("2027-03-01");
    expect(row.endOn).toBe("2027-03-01");
  });
});

describe("tâche des échéances", () => {
  it("un contrat en échec n'empêche pas les suivants", async () => {
    const poison = await activeContract({ endOn: "2026-11-01" });
    const healthy = await activeContract({ endOn: "2026-11-02" });
    await db.execute(sql`
      create function refuse_contract() returns trigger language plpgsql as $$
      begin raise exception 'ligne en échec'; end $$;
    `);
    await db.execute(
      sql.raw(`
      create trigger refuse_contract_trigger before update on contracts
      for each row when (new.id = '${poison.id}') execute function refuse_contract();
    `),
    );
    let result;
    try {
      result = await runContractDeadlines(db, { now: NOW });
    } finally {
      await db.execute(sql`drop trigger refuse_contract_trigger on contracts`);
      await db.execute(sql`drop function refuse_contract`);
    }
    expect(result.failed).toBe(1);
    expect((await rowOf(healthy.id)).status).toBe("expired");
    expect((await rowOf(poison.id)).status).toBe("active");
  });
});

describe("résiliation (08.04.03)", () => {
  it("sans site rattaché, liste les sites du client et leurs domaines", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const site = await createSite(db, { companyId: company.id });
    await db.insert(s.domains).values({
      companyId: company.id,
      siteId: site.id,
      name: `${site.id}.example`,
      expiresOn: "2027-02-01",
      autoRenew: true,
    });
    const { sites, impact } = await getContractRecord(admin, contract.id);
    expect(sites).toEqual([]);
    expect(impact.sites.map((row) => row.siteId)).toEqual([site.id]);
    expect(impact.domains).toEqual([
      { name: `${site.id}.example`, expiresOn: "2027-02-01", autoRenew: true },
    ]);
  });

  it("compte les coûts récurrents portés par le site couvert", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const site = await createSite(db, { companyId: company.id });
    await linkContractSite(admin, contract.id, { siteId: site.id });
    await db.insert(s.directCosts).values({
      companyId: company.id,
      siteId: site.id,
      label: "VPS",
      category: "hosting",
      amountCents: 1200,
      incurredOn: "2026-01-01",
      recurringPeriod: "monthly",
    });
    const { impact } = await getContractRecord(admin, contract.id);
    expect(impact.recurringCosts?.map((row) => row.label)).toEqual(["VPS"]);
    expect((await getContractRecord(member, contract.id)).impact.recurringCosts).toBeNull();
  });

  it("garde les transferts à prévoir sur la fiche", async () => {
    const contract = await activeContract();
    await terminateContract(
      admin,
      contract.id,
      { note: "Départ du client", transfers: "Domaine transféré au nouveau prestataire" },
      { now: NOW },
    );
    const row = await rowOf(contract.id);
    expect(row.terminationNote).toContain("Départ du client");
    expect(row.terminationNote).toContain("Domaine transféré au nouveau prestataire");
  });
});

describe("liens de la fiche", () => {
  it("propose les devis acceptés du client et accepte le devis choisi", async () => {
    const company = await createCompany(db);
    const other = await createCompany(db);
    const [accepted] = await db
      .insert(s.quotes)
      .values({ number: `TQ-${company.id}`, companyId: company.id, status: "accepted", title: "A" })
      .returning();
    await db
      .insert(s.quotes)
      .values({ number: `TQ2-${company.id}`, companyId: company.id, status: "draft", title: "B" });
    await db
      .insert(s.quotes)
      .values({ number: `TQ-${other.id}`, companyId: other.id, status: "accepted", title: "C" });
    if (!accepted) throw new Error("devis absent");

    const options = await getContractFormOptions(member);
    const forCompany = options.quotes.filter((row) => row.companyId === company.id);
    expect(forCompany.map((row) => row.id)).toEqual([accepted.id]);

    const created = await createContract(member, {
      companyId: company.id,
      name: "Depuis un devis",
      kind: "maintenance",
      period: "monthly",
      priceCents: "100",
      quoteId: accepted.id,
    });
    const record = await getContractRecord(member, created.id);
    expect(record.contract.quoteNumber).toBe(accepted.number);
    expect(record.quoteOptions.map((row) => row.id)).toEqual([accepted.id]);
    const asViewer = await getContractRecord(viewer, created.id);
    expect(asViewer.quoteOptions).toEqual([]);
  });

  it("montre les demandes du contrat avec leur couverture, ouvertes d'abord", async () => {
    const company = await createCompany(db);
    const contract = await activeContract({ companyId: company.id });
    const closed = await createTicket(db, {
      companyId: company.id,
      contractId: contract.id,
      status: "closed",
      coverage: "covered",
    });
    const open = await createTicket(db, {
      companyId: company.id,
      contractId: contract.id,
      status: "in_progress",
      coverage: "overage",
    });
    await createTicket(db, { companyId: company.id, status: "received" });
    const { tickets, ticketTotal } = await getContractRecord(viewer, contract.id);
    expect(tickets?.map((row) => row.id)).toEqual([open.id, closed.id]);
    expect(tickets?.[0]?.coverage).toBe("overage");
    expect(ticketTotal).toBe(2);
  });
});

describe("pagination", () => {
  it("une page au-delà de la dernière retombe sur la dernière", async () => {
    await activeContract();
    const result = await listContracts(admin, { filter: "all" }, { page: 9999, pageSize: 25 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.page).toBe(Math.ceil(result.total / 25));
  });

  it("même règle pour le journal", async () => {
    const contract = await activeContract();
    await createIntervention(admin, contract.id, { title: "Une", plannedOn: "2026-12-01" });
    const result = await listInterventions(admin, contract.id, { page: 50, pageSize: 10 });
    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(1);
  });
});
