import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpportunityStage } from "@/lib/domain-enums";
import { createCompany } from "@/modules/crm/company.service";
import { createContact } from "@/modules/crm/contact.service";
import {
  archiveOpportunity,
  createOpportunity,
  getOpportunity,
  getOpportunityStageHistory,
  getPipelineBoard,
  listOpportunities,
  listOpportunitiesForCompany,
  markOpportunityWon,
  markQuoteSent,
  moveOpportunityStage,
  restoreOpportunity,
  setNextAction,
  updateOpportunity,
} from "@/modules/sales/opportunity.service";
import { deriveUuid } from "@/modules/crm/crm.shared";
import * as s from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import {
  createCompany as createCompanyRow,
  createOpportunity as createOpportunityRow,
  createProject,
  createQuote,
} from "../../helpers/factories";
import { auditCount, createWorld, eventCount, uuid, type World } from "./world";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => w.close());

async function newCompany(name: string) {
  return createCompany(w.member, { name, allowSameName: "on" });
}

async function opportunityAt(stage: OpportunityStage, overrides: Record<string, unknown> = {}) {
  const company = await newCompany(`Client ${uuid().slice(0, 8)}`);
  const created = await createOpportunity(w.admin, {
    name: "Affaire",
    companyId: company.id,
    amountCents: 500_000,
    ...overrides,
  });
  const path: Record<OpportunityStage, OpportunityStage[]> = {
    NEW: [],
    QUALIFIED: ["QUALIFIED"],
    QUOTE_SENT: ["QUALIFIED", "QUOTE_SENT"],
    NEGOTIATION: ["QUALIFIED", "QUOTE_SENT", "NEGOTIATION"],
    WON: ["QUALIFIED", "QUOTE_SENT", "WON"],
    LOST: ["LOST"],
  };
  for (const to of path[stage]) {
    await moveOpportunityStage(w.admin, {
      opportunityId: created.id,
      toStage: to,
      lostReason: to === "LOST" ? "Budget" : undefined,
    });
  }
  return { id: created.id, twentyId: created.twentyId, companyId: company.id };
}

describe("création", () => {
  it("écrit dans Twenty puis localement : historique, audit, événement", async () => {
    const company = await newCompany("Ventes SARL");
    const contact = await createContact(w.member, { companyId: company.id, lastName: "Décide" });
    const opportunity = await createOpportunity(w.member, {
      name: "Site vitrine",
      companyId: company.id,
      contactId: contact.id,
      amountCents: "780000",
      expectedCloseOn: "2026-12-15",
      probability: "60",
      source: "Réseau",
      need: "Refonte",
      budgetEstimateCents: "800000",
      nextAction: "Rappeler",
      nextActionOn: "2026-11-10",
    });
    const twenty = w.crm.opportunities.get(opportunity.twentyId);
    expect(twenty?.amount).toEqual({ cents: 780000, currency: "EUR" });
    expect(twenty?.closeDate).toBe("2026-12-15");
    expect(twenty?.companyId).toBe(company.twentyId);
    expect(twenty?.pointOfContactId).toBe(contact.twentyId);
    expect(opportunity.probability).toBe(60);
    expect(await eventCount(w.db, "opportunity.created", opportunity.id)).toBe(1);
    const history = await getOpportunityStageHistory(w.viewer, opportunity.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.toStage).toBe("NEW");
  });

  it("un champ montant vide reste vide, pas zéro", async () => {
    const opportunity = await createOpportunity(w.member, {
      name: "Sans montant",
      amountCents: "",
      probability: "",
    });
    expect(opportunity.amountCents).toBeNull();
    expect(opportunity.probability).toBeNull();
  });

  it("se rejoue sans doublon", async () => {
    const id = uuid();
    await createOpportunity(w.member, { id, name: "Rejeu" });
    await createOpportunity(w.member, { id, name: "Rejeu" });
    expect(await auditCount(w.db, "opportunity.created", id)).toBe(1);
    expect(await eventCount(w.db, "opportunity.created", id)).toBe(1);
  });

  it("enregistre un lead d'une société inconnue, sans doublon à la reprise", async () => {
    const id = uuid();
    const first = await createOpportunity(w.member, {
      id,
      name: "Lead",
      newCompanyName: "Nouveau Prospect",
      source: "Site",
    });
    const companyId = deriveUuid("opportunity-company", id);
    expect(first.companyId).toBe(companyId);
    const [company] = await w.db.select().from(s.companies).where(eq(s.companies.id, companyId));
    expect(company?.status).toBe("prospect");
    expect(company?.source).toBe("Site");
    await createOpportunity(w.member, { id, name: "Lead", newCompanyName: "Nouveau Prospect" });
    expect(await auditCount(w.db, "company.created", companyId)).toBe(1);
  });

  it("refuse un contact d'un autre client, un client archivé ou inconnu", async () => {
    const a = await newCompany("Cloison A");
    const b = await newCompany("Cloison B");
    const contact = await createContact(w.member, { companyId: b.id, lastName: "B" });
    await expect(
      createOpportunity(w.member, { name: "x", companyId: a.id, contactId: contact.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createOpportunity(w.member, { name: "x", companyId: uuid() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("n'écrit rien si Twenty est coupé", async () => {
    w.crm.simulateOutage();
    try {
      await expect(createOpportunity(w.member, { name: "Panne" })).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
    } finally {
      w.crm.endOutage();
    }
    const rows = await w.db.select().from(s.opportunities).where(eq(s.opportunities.name, "Panne"));
    expect(rows).toHaveLength(0);
  });

  it("une écriture Twenty sur le jeu d'essai échoue honnêtement", async () => {
    const seed = await createCompanyRow(w.db, { twentyId: `seed-${uuid()}` });
    await expect(
      createOpportunity(w.member, { name: "x", companyId: seed.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    const row = await createOpportunityRow(w.db, {
      twentyId: `seed-${uuid()}`,
      companyId: seed.id,
    });
    await expect(
      moveOpportunityStage(w.member, { opportunityId: row.id, toStage: "QUALIFIED" }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Les colonnes de Nuera restent modifiables.
    const updated = await setNextAction(w.member, row.id, {
      nextAction: "Appeler",
      nextActionOn: "2026-11-20",
    });
    expect(updated.nextAction).toBe("Appeler");
  });
});

describe("machine à états", () => {
  const allowed: [OpportunityStage, OpportunityStage][] = [
    ["NEW", "QUALIFIED"],
    ["QUALIFIED", "NEW"],
    ["QUALIFIED", "QUOTE_SENT"],
    ["QUOTE_SENT", "QUALIFIED"],
    ["QUOTE_SENT", "NEGOTIATION"],
    ["QUOTE_SENT", "WON"],
    ["NEGOTIATION", "QUOTE_SENT"],
    ["NEGOTIATION", "WON"],
    ["NEGOTIATION", "LOST"],
    ["NEW", "LOST"],
    ["QUALIFIED", "LOST"],
    ["QUOTE_SENT", "LOST"],
  ];
  it.each(allowed)("%s → %s est permis, écrit dans Twenty et l'historique", async (from, to) => {
    const { id, twentyId } = await opportunityAt(from);
    const moved = await moveOpportunityStage(w.member, {
      opportunityId: id,
      toStage: to,
      lostReason: to === "LOST" ? "Délai" : undefined,
    });
    expect(moved.stage).toBe(to);
    expect(w.crm.opportunities.get(twentyId)?.stage).toBe(to);
    const history = await getOpportunityStageHistory(w.viewer, id);
    expect(history[0]).toMatchObject({ fromStage: from, toStage: to });
    expect(await eventCount(w.db, "opportunity.stage_changed", id)).toBeGreaterThan(0);
  });

  const refused: [OpportunityStage, OpportunityStage][] = [
    ["NEW", "QUOTE_SENT"],
    ["NEW", "NEGOTIATION"],
    ["NEW", "WON"],
    ["QUALIFIED", "NEGOTIATION"],
    ["QUALIFIED", "WON"],
  ];
  it.each(refused)("%s → %s est refusé, rien n'est écrit", async (from, to) => {
    const { id, twentyId } = await opportunityAt(from);
    await expect(
      moveOpportunityStage(w.member, { opportunityId: id, toStage: to }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(w.crm.opportunities.get(twentyId)?.stage).toBe(from);
  });

  it("répéter une transition ne change rien", async () => {
    const { id } = await opportunityAt("QUALIFIED");
    const before = (await getOpportunityStageHistory(w.viewer, id)).length;
    await moveOpportunityStage(w.member, { opportunityId: id, toStage: "QUALIFIED" });
    expect((await getOpportunityStageHistory(w.viewer, id)).length).toBe(before);
  });

  it("LOST exige un motif, conservé avec la date et l'événement", async () => {
    const { id } = await opportunityAt("QUALIFIED");
    await expect(
      moveOpportunityStage(w.member, { opportunityId: id, toStage: "LOST" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      moveOpportunityStage(w.member, { opportunityId: id, toStage: "LOST", lostReason: "   " }),
    ).rejects.toBeInstanceOf(ConflictError);
    const lost = await moveOpportunityStage(w.member, {
      opportunityId: id,
      toStage: "LOST",
      lostReason: "A choisi un template",
    });
    expect(lost.lostReason).toBe("A choisi un template");
    expect(lost.lostAt).not.toBeNull();
    expect(await eventCount(w.db, "opportunity.lost", id)).toBe(1);
    expect(await auditCount(w.db, "opportunity.lost", id)).toBe(1);
  });

  it("WON exige un client et un montant", async () => {
    const noCompany = await createOpportunity(w.admin, { name: "Sans client", amountCents: 100 });
    await moveOpportunityStage(w.admin, { opportunityId: noCompany.id, toStage: "QUALIFIED" });
    await moveOpportunityStage(w.admin, { opportunityId: noCompany.id, toStage: "QUOTE_SENT" });
    await expect(
      moveOpportunityStage(w.member, { opportunityId: noCompany.id, toStage: "WON" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const { id } = await opportunityAt("QUOTE_SENT", { amountCents: "" });
    await expect(
      moveOpportunityStage(w.member, { opportunityId: id, toStage: "WON" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("WON convertit le prospect en client et émet l'événement", async () => {
    const { id, companyId } = await opportunityAt("QUOTE_SENT");
    const won = await moveOpportunityStage(w.member, { opportunityId: id, toStage: "WON" });
    expect(won.wonAt).not.toBeNull();
    const [company] = await w.db.select().from(s.companies).where(eq(s.companies.id, companyId));
    expect(company?.status).toBe("client");
    expect(await eventCount(w.db, "opportunity.won", id)).toBe(1);
    expect(await auditCount(w.db, "company.status_changed", companyId)).toBe(1);
  });

  it("la réouverture est réservée aux associés", async () => {
    const { id } = await opportunityAt("LOST");
    await expect(
      moveOpportunityStage(w.member, { opportunityId: id, toStage: "NEW" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const reopened = await moveOpportunityStage(w.admin, { opportunityId: id, toStage: "NEW" });
    expect(reopened.stage).toBe("NEW");
    expect(reopened.lostAt).toBeNull();
    expect(reopened.lostReason).toBeNull();
    expect(await auditCount(w.db, "opportunity.reopened", id)).toBe(1);

    const won = await opportunityAt("WON");
    await expect(
      moveOpportunityStage(w.member, { opportunityId: won.id, toStage: "NEGOTIATION" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const back = await moveOpportunityStage(w.admin, {
      opportunityId: won.id,
      toStage: "NEGOTIATION",
    });
    expect(back.wonAt).toBeNull();
    // Une affaire close ne passe pas d'une clôture à l'autre.
    const closed = await opportunityAt("WON");
    await expect(
      moveOpportunityStage(w.admin, { opportunityId: closed.id, toStage: "LOST", lostReason: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("une panne de Twenty laisse l'affaire à sa place", async () => {
    const { id } = await opportunityAt("NEW");
    w.crm.simulateOutage();
    try {
      await expect(
        moveOpportunityStage(w.member, { opportunityId: id, toStage: "QUALIFIED" }),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    } finally {
      w.crm.endOutage();
    }
    expect((await getOpportunity(w.viewer, id)).stage).toBe("NEW");
  });
});

describe("modification", () => {
  it("les colonnes (T) passent par Twenty, les autres non", async () => {
    const { id, twentyId } = await opportunityAt("NEW");
    w.crm.simulateOutage();
    try {
      const local = await updateOpportunity(w.member, id, {
        probability: "40",
        source: "Site",
        nextAction: "Envoyer le brief",
      });
      expect(local.probability).toBe(40);
      await expect(updateOpportunity(w.member, id, { name: "Renommée" })).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
    } finally {
      w.crm.endOutage();
    }
    const updated = await updateOpportunity(w.member, id, {
      name: "Renommée",
      amountCents: "120000",
      expectedCloseOn: "2027-01-15",
    });
    expect(updated.name).toBe("Renommée");
    expect(w.crm.opportunities.get(twentyId)?.amount?.cents).toBe(120000);
    expect(w.crm.opportunities.get(twentyId)?.closeDate).toBe("2027-01-15");
    expect(updated.twentySyncedAt).not.toBeNull();
  });

  it("refuse la probabilité hors bornes", async () => {
    const { id } = await opportunityAt("NEW");
    await expect(updateOpportunity(w.member, id, { probability: "120" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("change de client, vide le contact et les liens ; refusé si un devis est rattaché", async () => {
    const a = await newCompany("Mouvement A");
    const b = await newCompany("Mouvement B");
    const contact = await createContact(w.member, { companyId: a.id, lastName: "A" });
    const opportunity = await createOpportunity(w.member, {
      name: "Mobile",
      companyId: a.id,
      contactId: contact.id,
    });
    const moved = await updateOpportunity(w.member, opportunity.id, { companyId: b.id });
    expect(moved.companyId).toBe(b.id);
    expect(moved.contactId).toBeNull();

    await createQuote(w.db, { companyId: b.id, opportunityId: opportunity.id });
    await expect(
      updateOpportunity(w.member, opportunity.id, { companyId: a.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("une affaire gagnée garde son client et son montant", async () => {
    const { id } = await opportunityAt("WON");
    await expect(updateOpportunity(w.member, id, { amountCents: "" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(updateOpportunity(w.member, id, { companyId: "" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("archive et restaure", async () => {
    const { id, twentyId } = await opportunityAt("NEW");
    await archiveOpportunity(w.member, id);
    expect(w.crm.opportunities.get(twentyId)?.deletedAt).not.toBeNull();
    await archiveOpportunity(w.member, id);
    expect(await auditCount(w.db, "opportunity.archived", id)).toBe(1);
    await expect(
      moveOpportunityStage(w.member, { opportunityId: id, toStage: "QUALIFIED" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const archived = await listOpportunities(w.member, { archivees: "1" });
    expect(archived.items.map((row) => row.id)).toContain(id);
    const restored = await restoreOpportunity(w.member, id);
    expect(restored.archivedAt).toBeNull();
  });
});

describe("devis (contrat avec le lot Devis)", () => {
  async function quoteFor(companyId: string, opportunityId: string, totalCents = 123_400) {
    const { quote } = await createQuote(w.db, { companyId, opportunityId }, { totalCents });
    return quote;
  }

  it("markQuoteSent avance étape par étape, est idempotent, ignore une affaire close", async () => {
    const { id, twentyId } = await opportunityAt("NEW");
    await w.db.transaction((tx) => markQuoteSent(w.member, tx, { opportunityId: id }));
    expect(w.crm.opportunities.get(twentyId)?.stage).toBe("QUOTE_SENT");
    const history = await getOpportunityStageHistory(w.viewer, id);
    expect(history.map((row) => row.toStage)).toEqual(
      expect.arrayContaining(["QUALIFIED", "QUOTE_SENT"]),
    );
    const size = history.length;
    await w.db.transaction((tx) => markQuoteSent(w.member, tx, { opportunityId: id }));
    expect((await getOpportunityStageHistory(w.viewer, id)).length).toBe(size);

    const lost = await opportunityAt("LOST");
    const kept = await w.db.transaction((tx) =>
      markQuoteSent(w.member, tx, { opportunityId: lost.id }),
    );
    expect(kept.stage).toBe("LOST");

    const negotiating = await opportunityAt("NEGOTIATION");
    const back = await w.db.transaction((tx) =>
      markQuoteSent(w.member, tx, { opportunityId: negotiating.id }),
    );
    expect(back.stage).toBe("QUOTE_SENT");
  });

  it("markOpportunityWon gagne, reprend le montant du devis, et n'émet qu'une fois", async () => {
    const { id, twentyId, companyId } = await opportunityAt("QUALIFIED", { amountCents: "" });
    const quote = await quoteFor(companyId, id, 987_600);
    const won = await w.db.transaction((tx) =>
      markOpportunityWon(w.member, tx, { opportunityId: id, quoteId: quote.id }),
    );
    expect(won.stage).toBe("WON");
    expect(won.amountCents).toBe(987_600);
    expect(w.crm.opportunities.get(twentyId)?.stage).toBe("WON");
    expect(w.crm.opportunities.get(twentyId)?.amount?.cents).toBe(987_600);
    const [company] = await w.db.select().from(s.companies).where(eq(s.companies.id, companyId));
    expect(company?.status).toBe("client");

    await w.db.transaction((tx) =>
      markOpportunityWon(w.member, tx, { opportunityId: id, quoteId: quote.id }),
    );
    expect(await eventCount(w.db, "opportunity.won", id)).toBe(1);
    expect(await auditCount(w.db, "opportunity.won", id)).toBe(1);
  });

  it("markOpportunityWon depuis la négociation : gagné direct", async () => {
    const { id, companyId } = await opportunityAt("NEGOTIATION");
    const quote = await quoteFor(companyId, id);
    const won = await w.db.transaction((tx) =>
      markOpportunityWon(w.member, tx, { opportunityId: id, quoteId: quote.id }),
    );
    expect(won.stage).toBe("WON");
    const history = await getOpportunityStageHistory(w.viewer, id);
    expect(history[0]).toMatchObject({ fromStage: "NEGOTIATION", toStage: "WON" });
  });

  it("refuse une affaire perdue, inconnue, ou le devis d'une autre affaire", async () => {
    const lost = await opportunityAt("LOST");
    const quote = await quoteFor(lost.companyId, lost.id);
    await expect(
      w.db.transaction((tx) =>
        markOpportunityWon(w.member, tx, { opportunityId: lost.id, quoteId: quote.id }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const other = await opportunityAt("QUOTE_SENT");
    await expect(
      w.db.transaction((tx) =>
        markOpportunityWon(w.member, tx, { opportunityId: other.id, quoteId: quote.id }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      w.db.transaction((tx) =>
        markOpportunityWon(w.member, tx, { opportunityId: uuid(), quoteId: quote.id }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("une panne de Twenty annule la transaction de l'appelant, qui se rejoue", async () => {
    const { id, companyId } = await opportunityAt("QUOTE_SENT");
    const quote = await quoteFor(companyId, id);
    w.crm.simulateOutage();
    await expect(
      w.db.transaction(async (tx) => {
        await tx.update(s.quotes).set({ status: "accepted" }).where(eq(s.quotes.id, quote.id));
        return markOpportunityWon(w.member, tx, { opportunityId: id, quoteId: quote.id });
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    w.crm.endOutage();
    const [row] = await w.db.select().from(s.quotes).where(eq(s.quotes.id, quote.id));
    expect(row?.status).not.toBe("accepted");
    expect((await getOpportunity(w.viewer, id)).stage).toBe("QUOTE_SENT");
    const won = await w.db.transaction((tx) =>
      markOpportunityWon(w.member, tx, { opportunityId: id, quoteId: quote.id }),
    );
    expect(won.stage).toBe("WON");
  });
});

describe("lectures", () => {
  it("le tableau résume les ouvertes, plafonne les colonnes, filtre", async () => {
    const company = await newCompany("Tableau SAS");
    const owner = (w.admin as World["admin"] & { member: { id: string } }).member.id;
    await createOpportunity(w.admin, {
      name: "Filtrée",
      companyId: company.id,
      source: "Mini-audit",
      ownerMemberId: owner,
      amountCents: "100000",
    });
    const board = await getPipelineBoard(w.viewer, {});
    expect(board.openCount).toBeGreaterThan(0);
    expect(board.columns).toHaveLength(6);
    expect(board.openAmountCents).toBeGreaterThanOrEqual(100000);

    const filtered = await getPipelineBoard(w.viewer, { origine: "Mini-audit" });
    expect(filtered.cards.every((card) => card.source === "Mini-audit")).toBe(true);
    const byOwner = await getPipelineBoard(w.viewer, { responsable: owner });
    expect(byOwner.cards.every((card) => card.ownerMemberId === owner)).toBe(true);
  });

  it("ne garde pas plus de cartes que la limite par colonne, et compte le reste", async () => {
    const company = await newCompany("Volume SAS");
    await w.db.insert(s.opportunities).values(
      Array.from({ length: 45 }, (_, index) => ({
        twentyId: `test-volume-${index}-${uuid()}`,
        name: `Volume ${index}`,
        stage: "NEGOTIATION" as const,
        companyId: company.id,
      })),
    );
    const board = await getPipelineBoard(w.viewer, {});
    expect(board.cards.filter((card) => card.stage === "NEGOTIATION").length).toBe(40);
    expect(board.hiddenCount).toBeGreaterThan(0);
    const page = await listOpportunities(w.viewer, {
      etape: "NEGOTIATION",
      pageSize: "10",
      page: "2",
    });
    expect(page.items).toHaveLength(10);
    expect(page.page).toBe(2);
    expect(page.total).toBeGreaterThanOrEqual(45);
  });

  it("repère les affaires inactives", async () => {
    const company = await newCompany("Dormante SAS");
    const row = await createOpportunityRow(w.db, {
      companyId: company.id,
      name: "Dormante",
      lastActivityAt: new Date(Date.now() - 40 * 86_400_000),
    });
    const fresh = await createOpportunity(w.member, { name: "Fraîche", companyId: company.id });
    const idle = await listOpportunities(w.viewer, { inactives: "14" });
    const ids = idle.items.map((item) => item.id);
    expect(ids).toContain(row.id);
    expect(ids).not.toContain(fresh.id);
    expect(idle.items.find((item) => item.id === row.id)?.idleDays).toBeGreaterThanOrEqual(39);
  });

  it("donne les affaires d'un client, les ouvertes d'abord", async () => {
    const { id, companyId } = await opportunityAt("LOST");
    const open = await createOpportunity(w.member, { name: "Ouverte", companyId });
    const rows = await listOpportunitiesForCompany(w.viewer, companyId, { limit: 5 });
    expect(rows.map((row) => row.id)).toEqual([open.id, id]);
  });

  it("répond 404 pour une affaire inconnue", async () => {
    await expect(getOpportunity(w.viewer, uuid())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("permissions par rôle", () => {
  it("prestataire : rien ; lecteur : lecture seule ; collaborateur : écrit sans rouvrir", async () => {
    await expect(getPipelineBoard(w.contractor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOpportunities(w.contractor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getOpportunity(w.contractor, uuid())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createOpportunity(w.viewer, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      moveOpportunityStage(w.viewer, { opportunityId: uuid(), toStage: "NEW" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateOpportunity(w.viewer, uuid(), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(archiveOpportunity(w.viewer, uuid())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("cloisonnement en SQL", () => {
  it("un projet rattaché fige aussi le client de l'affaire", async () => {
    const { id, companyId } = await opportunityAt("NEW");
    await createProject(w.db, { companyId, opportunityId: id });
    const other = await newCompany("Autre projet");
    await expect(updateOpportunity(w.member, id, { companyId: other.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
