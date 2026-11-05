import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertIndyApiAvailable,
  INDY_CONNECTION_STATUS,
  isIndyApiConfigured,
} from "@/integrations/indy/indy.connection";
import {
  changeInvoiceStatus,
  createDirectCost,
  createInvoiceReference,
  createScheduleItem,
  archiveDirectCost,
  archiveScheduleItem,
  getFinanceOverview,
  getFinanceSummary,
  getInvoice,
  getRecurringOverview,
  listInvoices,
  listInvoicesForCompany,
  listInvoicesForPortal,
  listOverdueInvoices,
  markOverdueInvoices,
  setInvoiceClientVisibility,
  updateInvoiceReference,
} from "@/modules/finance/finance.service";
import {
  canInvoiceTransition,
  INVOICE_TRANSITIONS,
  INVOICE_STATUSES,
} from "@/modules/finance/invoice.status";
import {
  canScheduleTransition,
  deriveScheduleStatus,
  SCHEDULE_ITEM_STATUSES,
  SCHEDULE_TRANSITIONS,
} from "@/modules/finance/schedule.status";
import type { ServiceContext } from "@/server/context";
import {
  auditLog,
  directCosts,
  domainEvents,
  financialDocuments,
  paymentScheduleItems,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createPortalTestContext,
  createProject,
  createTeamMember,
} from "../../helpers/factories";

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let issuerA: string;
let issuerB: string;
let refCounter = 0;

const NOW = new Date("2026-11-04T12:00:00Z");
const nextRef = () => `INV-${(refCounter += 1)}`;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createTestContext(db, "admin");
  issuerA = (await createTeamMember(db, { kind: "partner", fullName: "Ethan Ngo" })).id;
  issuerB = (await createTeamMember(db, { kind: "partner", fullName: "Nezar Zakaria" })).id;
});
afterAll(async () => close());

function invoiceInput(companyId: string, overrides: Record<string, unknown> = {}) {
  return {
    companyId,
    externalRef: nextRef(),
    issuerMemberId: issuerA,
    issuedOn: "2026-10-20",
    dueOn: "2026-11-30",
    amountCents: "100000",
    taxCents: "20000",
    ...overrides,
  };
}

async function eventsFor(type: string, entityId: string) {
  return db
    .select()
    .from(domainEvents)
    .where(and(eq(domainEvents.type, type), eq(domainEvents.entityId, entityId)));
}

describe("machines d'états", () => {
  it("facture : seuls les passages de la table sont permis", () => {
    for (const from of INVOICE_STATUSES) {
      for (const to of INVOICE_STATUSES) {
        expect(canInvoiceTransition(from, to)).toBe(INVOICE_TRANSITIONS[from].includes(to));
      }
    }
    expect(INVOICE_TRANSITIONS.cancelled).toEqual([]);
    expect(canInvoiceTransition("overdue", "issued")).toBe(true);
    expect(canInvoiceTransition("paid", "overdue")).toBe(false);
  });

  it("échéance : tous les chemins de la table", () => {
    for (const from of SCHEDULE_ITEM_STATUSES) {
      for (const to of SCHEDULE_ITEM_STATUSES) {
        expect(canScheduleTransition(from, to)).toBe(SCHEDULE_TRANSITIONS[from].includes(to));
      }
    }
  });

  it("échéance : son état découle de ses factures", () => {
    expect(deriveScheduleStatus({ amountCents: 100, liveCount: 0, paidCents: 0 })).toBe("planned");
    expect(deriveScheduleStatus({ amountCents: 100, liveCount: 2, paidCents: 50 })).toBe(
      "invoiced",
    );
    expect(deriveScheduleStatus({ amountCents: 100, liveCount: 2, paidCents: 100 })).toBe("paid");
  });
});

describe("référence de facture", () => {
  it("écrit la référence et sa trace d'audit dans la même opération", async () => {
    const company = await createCompany(db);
    const created = await createInvoiceReference(admin, invoiceInput(company.id), NOW);
    expect(created).toMatchObject({ source: "manual", status: "issued", amountCents: 100000 });
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.entityId, created.id), eq(auditLog.action, "financial_document.created")),
      );
    expect(audit).toHaveLength(1);
  });

  it("refuse une référence en double, quelle que soit sa source", async () => {
    const company = await createCompany(db);
    const input = invoiceInput(company.id);
    await createInvoiceReference(admin, input, NOW);
    await expect(createInvoiceReference(admin, input, NOW)).rejects.toThrow(ConflictError);
  });

  it("exige un associé émetteur et une référence", async () => {
    const company = await createCompany(db);
    await expect(
      createInvoiceReference(admin, invoiceInput(company.id, { issuerMemberId: "" }), NOW),
    ).rejects.toThrow(ValidationError);
    await expect(
      createInvoiceReference(admin, invoiceInput(company.id, { externalRef: "  " }), NOW),
    ).rejects.toThrow(ValidationError);
  });

  it("stocke un avoir en négatif : les sommes de revenus restent justes", async () => {
    const company = await createCompany(db);
    const credit = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { kind: "credit_note", amountCents: "30000", taxCents: "6000" }),
      NOW,
    );
    expect(credit).toMatchObject({ amountCents: -30000, taxCents: -6000 });
  });

  it("refuse un lien vers le projet, le contrat ou l'échéance d'un autre client", async () => {
    const [mine, other] = [await createCompany(db), await createCompany(db)];
    const project = await createProject(db, { companyId: other.id });
    const contract = await createContract(db, { companyId: other.id });
    const item = await createScheduleItem(admin, {
      companyId: other.id,
      label: "Acompte",
      amountCents: "1000",
    });
    for (const link of [
      { projectId: project.id },
      { contractId: contract.id },
      { scheduleItemId: item.id },
    ]) {
      await expect(createInvoiceReference(admin, invoiceInput(mine.id, link), NOW)).rejects.toThrow(
        ValidationError,
      );
    }
    await expect(
      createScheduleItem(admin, {
        companyId: mine.id,
        projectId: project.id,
        label: "Solde",
        amountCents: "1000",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createDirectCost(admin, {
        companyId: mine.id,
        contractId: contract.id,
        label: "Serveur",
        category: "hosting",
        amountCents: "1000",
        incurredOn: "2026-10-01",
        nature: "actual",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("répond 404 pour une facture inconnue ou un identifiant mal formé", async () => {
    await expect(getInvoice(admin, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      NotFoundError,
    );
    await expect(getInvoice(admin, "pas-un-uuid")).rejects.toThrow(NotFoundError);
  });
});

describe("paiement et retard", () => {
  it("le paiement émet invoice.paid une seule fois, l'action répétée ne change rien", async () => {
    const company = await createCompany(db);
    const invoice = await createInvoiceReference(admin, invoiceInput(company.id), NOW);
    const paid = await changeInvoiceStatus(
      admin,
      invoice.id,
      { to: "paid", paidOn: "2026-11-03" },
      NOW,
    );
    expect(paid).toMatchObject({ status: "paid", paidOn: "2026-11-03" });
    await changeInvoiceStatus(admin, invoice.id, { to: "paid", paidOn: "2026-11-03" }, NOW);
    expect(await eventsFor("invoice.paid", invoice.id)).toHaveLength(1);
  });

  it("corriger un encaissement puis repayer n'émet pas un second invoice.paid", async () => {
    const company = await createCompany(db);
    const invoice = await createInvoiceReference(admin, invoiceInput(company.id), NOW);
    await changeInvoiceStatus(admin, invoice.id, { to: "paid", paidOn: "2026-11-03" }, NOW);
    const reopened = await changeInvoiceStatus(admin, invoice.id, { to: "issued" }, NOW);
    expect(reopened).toMatchObject({ status: "issued", paidOn: null });
    await changeInvoiceStatus(admin, invoice.id, { to: "paid", paidOn: "2026-11-04" }, NOW);
    expect(await eventsFor("invoice.paid", invoice.id)).toHaveLength(1);
  });

  it("refuse une date de paiement future et un passage hors de la machine", async () => {
    const company = await createCompany(db);
    const invoice = await createInvoiceReference(admin, invoiceInput(company.id), NOW);
    await expect(
      changeInvoiceStatus(admin, invoice.id, { to: "paid", paidOn: "2026-12-01" }, NOW),
    ).rejects.toThrow(ValidationError);
    await expect(changeInvoiceStatus(admin, invoice.id, { to: "overdue" }, NOW)).rejects.toThrow(
      ConflictError,
    );
    await changeInvoiceStatus(admin, invoice.id, { to: "cancelled" }, NOW);
    await expect(
      changeInvoiceStatus(admin, invoice.id, { to: "paid", paidOn: "2026-11-01" }, NOW),
    ).rejects.toThrow(ConflictError);
    await expect(
      updateInvoiceReference(admin, invoice.id, invoiceInput(company.id), NOW),
    ).rejects.toThrow(ConflictError);
  });

  it("la tâche passe les échéances dépassées en retard, une seule fois", async () => {
    const company = await createCompany(db);
    const late = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { issuedOn: "2026-09-01", dueOn: "2026-10-01" }),
      new Date("2026-09-15T12:00:00Z"),
    );
    expect(late.status).toBe("issued");

    expect(await markOverdueInvoices(db, NOW)).toBeGreaterThanOrEqual(1);
    const [stored] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.id, late.id));
    expect(stored?.status).toBe("overdue");

    expect(await markOverdueInvoices(db, NOW)).toBe(0);
    expect(await eventsFor("invoice.overdue", late.id)).toHaveLength(1);
  });

  it("l'échéance du jour même n'est pas en retard : minuit se compte à Paris", async () => {
    const company = await createCompany(db);
    const today = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { issuedOn: "2026-10-01", dueOn: "2026-11-04" }),
      NOW,
    );
    expect(today.status).toBe("issued");
    // 23 h 30 UTC le 4 novembre : il est déjà le 5 à Paris.
    await markOverdueInvoices(db, new Date("2026-11-04T23:30:00Z"));
    const [stored] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.id, today.id));
    expect(stored?.status).toBe("overdue");
  });

  it("listOverdueInvoices calcule le retard même si la tâche n'a pas tourné", async () => {
    const company = await createCompany(db);
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { issuedOn: "2026-08-01", dueOn: "2026-09-01" }),
      new Date("2026-08-15T12:00:00Z"),
    );
    const overdue = await listOverdueInvoices(db, NOW);
    expect(overdue.find((row) => row.id === invoice.id)?.status).toBe("overdue");
    await changeInvoiceStatus(admin, invoice.id, { to: "paid", paidOn: "2026-11-01" }, NOW);
    expect((await listOverdueInvoices(db, NOW)).some((row) => row.id === invoice.id)).toBe(false);
  });

  it("repousser l'échéance sort du retard ; un nouveau dépassement alerte à nouveau", async () => {
    const company = await createCompany(db);
    const input = invoiceInput(company.id, { issuedOn: "2026-09-01", dueOn: "2026-10-01" });
    const invoice = await createInvoiceReference(admin, input, NOW);
    expect(invoice.status).toBe("overdue");
    const moved = await updateInvoiceReference(
      admin,
      invoice.id,
      { ...input, dueOn: "2026-12-01" },
      NOW,
    );
    expect(moved.status).toBe("issued");
    await markOverdueInvoices(db, new Date("2026-12-15T12:00:00Z"));
    expect(await eventsFor("invoice.overdue", invoice.id)).toHaveLength(2);
  });
});

describe("échéancier en co-traitance (A12)", () => {
  it("une échéance porte une facture par associé, et n'est payée que couverte", async () => {
    const company = await createCompany(db);
    const item = await createScheduleItem(admin, {
      companyId: company.id,
      label: "Acompte 30 %",
      dueOn: "2026-11-20",
      amountCents: "234000",
    });
    const first = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { scheduleItemId: item.id, amountCents: "117000" }),
      NOW,
    );
    const second = await createInvoiceReference(
      admin,
      invoiceInput(company.id, {
        scheduleItemId: item.id,
        amountCents: "117000",
        issuerMemberId: issuerB,
      }),
      NOW,
    );
    const statusOf = async () => {
      const [row] = await db
        .select()
        .from(paymentScheduleItems)
        .where(eq(paymentScheduleItems.id, item.id));
      return row;
    };
    expect(await statusOf()).toMatchObject({ status: "invoiced", financialDocumentId: first.id });

    await changeInvoiceStatus(admin, first.id, { to: "paid", paidOn: "2026-11-03" }, NOW);
    expect((await statusOf())?.status).toBe("invoiced");
    await changeInvoiceStatus(admin, second.id, { to: "paid", paidOn: "2026-11-03" }, NOW);
    expect((await statusOf())?.status).toBe("paid");

    await changeInvoiceStatus(admin, second.id, { to: "issued" }, NOW);
    expect((await statusOf())?.status).toBe("invoiced");
  });

  it("refuse des factures au-delà du montant de l'échéance", async () => {
    const company = await createCompany(db);
    const item = await createScheduleItem(admin, {
      companyId: company.id,
      label: "Solde",
      amountCents: "1000",
    });
    await expect(
      createInvoiceReference(
        admin,
        invoiceInput(company.id, { scheduleItemId: item.id, amountCents: "1001" }),
        NOW,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("une facture annulée remet l'échéance en prévision, mais l'historique empêche de la retirer", async () => {
    const company = await createCompany(db);
    const item = await createScheduleItem(admin, {
      companyId: company.id,
      label: "Solde",
      amountCents: "1000",
    });
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { scheduleItemId: item.id, amountCents: "1000" }),
      NOW,
    );
    await changeInvoiceStatus(admin, invoice.id, { to: "cancelled" }, NOW);
    const [row] = await db
      .select()
      .from(paymentScheduleItems)
      .where(eq(paymentScheduleItems.id, item.id));
    expect(row).toMatchObject({ status: "planned", financialDocumentId: null });
    await expect(archiveScheduleItem(admin, item.id)).rejects.toThrow(ConflictError);
  });

  it("une échéance sans facture se retire, avec trace", async () => {
    const company = await createCompany(db);
    const item = await createScheduleItem(admin, {
      companyId: company.id,
      label: "À retirer",
      amountCents: "1000",
    });
    await archiveScheduleItem(admin, item.id);
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, item.id), eq(auditLog.action, "schedule_item.archived")));
    expect(audit).toHaveLength(1);
  });
});

describe("coûts", () => {
  it("un coût ponctuel à zéro est refusé, un récurrent reste à chiffrer", async () => {
    const base = {
      label: "VPS",
      category: "hosting",
      amountCents: "0",
      incurredOn: "2026-01-01",
      nature: "actual",
    };
    await expect(createDirectCost(admin, base)).rejects.toThrow(ValidationError);
    const cost = await createDirectCost(admin, { ...base, recurringPeriod: "monthly" });
    const overview = await getRecurringOverview(admin);
    expect(overview.lines.find((line) => line.id === cost.id)?.monthlyCents).toBeNull();
    expect(overview.toQuantifyCount).toBeGreaterThanOrEqual(1);
    await archiveDirectCost(admin, cost.id);
    const [archived] = await db.select().from(directCosts).where(eq(directCosts.id, cost.id));
    expect(archived?.archivedAt).not.toBeNull();
    const after = await getRecurringOverview(admin);
    expect(after.lines.find((line) => line.id === cost.id)).toBeUndefined();
    await expect(archiveDirectCost(admin, cost.id)).rejects.toThrow(NotFoundError);
  });

  it("un abonnement est déficitaire si ses coûts dépassent son prix mensuel", async () => {
    const company = await createCompany(db);
    const healthy = await createContract(db, {
      companyId: company.id,
      status: "active",
      priceCents: 12000,
      period: "quarterly",
      monthlyCostCents: 3000,
    });
    const deficit = await createContract(db, {
      companyId: company.id,
      status: "active",
      priceCents: 12000,
      period: "yearly",
      monthlyCostCents: 3000,
    });
    const unknown = await createContract(db, {
      companyId: company.id,
      status: "active",
      priceCents: 12000,
      period: "monthly",
    });
    await createDirectCost(admin, {
      companyId: company.id,
      contractId: unknown.id,
      label: "Serveur",
      category: "hosting",
      amountCents: "20000",
      incurredOn: "2026-01-01",
      recurringPeriod: "monthly",
      nature: "actual",
    });
    const overview = await getRecurringOverview(admin);
    const ids = overview.deficits.map((row) => row.contractId);
    expect(ids).toContain(deficit.id);
    expect(ids).toContain(unknown.id);
    expect(ids).not.toContain(healthy.id);
    expect(overview.deficits.find((row) => row.contractId === deficit.id)).toMatchObject({
      monthlyPriceCents: 1000,
      monthlyCostCents: 3000,
      deficitCents: 2000,
    });
  });
});

describe("listes et synthèse", () => {
  it("pagine côté serveur et filtre par état et par recherche", async () => {
    const company = await createCompany(db, { name: "Pagination & Cie" });
    for (let index = 0; index < 3; index += 1) {
      await createInvoiceReference(admin, invoiceInput(company.id), NOW);
    }
    const page = await listInvoices(admin, { search: "Pagination" }, { page: 2, pageSize: 2 }, NOW);
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items).toHaveLength(1);
    const none = await listInvoices(
      admin,
      { search: "Pagination", status: "paid" },
      { page: 1, pageSize: 10 },
      NOW,
    );
    expect(none.total).toBe(0);
    // Un joker saisi n'élargit pas la recherche.
    expect((await listInvoices(admin, { search: "%" }, { page: 1, pageSize: 10 }, NOW)).total).toBe(
      0,
    );
  });

  it("listInvoicesForCompany ne renvoie que ce client", async () => {
    const [mine, other] = [await createCompany(db), await createCompany(db)];
    const invoice = await createInvoiceReference(admin, invoiceInput(mine.id), NOW);
    await createInvoiceReference(admin, invoiceInput(other.id), NOW);
    const rows = await listInvoicesForCompany(admin, mine.id, { limit: 5 }, NOW);
    expect(rows.map((row) => row.id)).toEqual([invoice.id]);
  });

  it("getFinanceSummary sépare encaissé, à encaisser et retard", async () => {
    const isolated = await createTestDatabase();
    try {
      const ctx = await createTestContext(isolated.db, "admin");
      const company = await createCompany(isolated.db);
      const member = await createTeamMember(isolated.db, {
        kind: "partner",
        fullName: "Associée Test",
      });
      const input = (overrides: Record<string, unknown>) => ({
        companyId: company.id,
        issuerMemberId: member.id,
        issuedOn: "2026-10-01",
        amountCents: "10000",
        ...overrides,
      });
      const paid = await createInvoiceReference(
        ctx,
        input({ externalRef: "A", dueOn: "2026-12-01" }),
        NOW,
      );
      await changeInvoiceStatus(ctx, paid.id, { to: "paid", paidOn: "2026-11-02" }, NOW);
      await createInvoiceReference(
        ctx,
        input({ externalRef: "B", dueOn: "2026-12-01", amountCents: "20000" }),
        NOW,
      );
      await createInvoiceReference(
        ctx,
        input({ externalRef: "C", dueOn: "2026-10-15", amountCents: "40000" }),
        NOW,
      );
      const cancelled = await createInvoiceReference(
        ctx,
        input({ externalRef: "D", dueOn: "2026-12-01", amountCents: "80000" }),
        NOW,
      );
      await changeInvoiceStatus(ctx, cancelled.id, { to: "cancelled" }, NOW);
      await createContract(isolated.db, {
        companyId: company.id,
        status: "active",
        priceCents: 30000,
        period: "quarterly",
      });

      const summary = await getFinanceSummary(
        isolated.db,
        { from: "2026-11-01", to: "2026-11-30" },
        NOW,
      );
      expect(summary).toMatchObject({
        collectedCents: 10000,
        collectedDocuments: 1,
        outstandingCents: 20000,
        outstandingCount: 1,
        overdueCents: 40000,
        overdueCount: 1,
        mrrCents: 10000,
        runningContracts: 1,
      });
      expect(summary.months.at(-1)).toMatchObject({
        key: "2026-11",
        collectedCents: 10000,
        byIssuer: [{ memberId: member.id, name: "Associée Test", cents: 10000 }],
      });
    } finally {
      await isolated.close();
    }
  });
});

describe("droits et portail", () => {
  it("seul un associé lit et écrit les finances", async () => {
    const company = await createCompany(db);
    for (const role of ["member", "contractor", "viewer"] as const) {
      const ctx = await createTestContext(db, role);
      await expect(listInvoices(ctx, {}, { page: 1, pageSize: 5 }, NOW)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(getFinanceOverview(ctx, NOW)).rejects.toThrow(ForbiddenError);
      await expect(createInvoiceReference(ctx, invoiceInput(company.id), NOW)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(listInvoicesForCompany(ctx, company.id)).rejects.toThrow(ForbiddenError);
      await expect(
        createDirectCost(ctx, {
          label: "x",
          category: "other",
          amountCents: "1",
          incurredOn: "2026-01-01",
          nature: "actual",
        }),
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("le portail ne voit que les factures partagées de son client", async () => {
    const portal = await createPortalTestContext(db);
    const other = await createCompany(db);
    const shared = await createInvoiceReference(
      admin,
      invoiceInput(portal.company.id, { clientVisible: "on" }),
      NOW,
    );
    const internal = await createInvoiceReference(admin, invoiceInput(portal.company.id), NOW);
    await createInvoiceReference(admin, invoiceInput(other.id, { clientVisible: "on" }), NOW);

    const rows = await listInvoicesForPortal(portal, NOW);
    expect(rows.map((row) => row.id)).toEqual([shared.id]);
    expect(rows[0]).not.toHaveProperty("issuerName");

    await setInvoiceClientVisibility(admin, internal.id, true);
    expect(await listInvoicesForPortal(portal, NOW)).toHaveLength(2);
    await changeInvoiceStatus(admin, internal.id, { to: "cancelled" }, NOW);
    expect(await listInvoicesForPortal(portal, NOW)).toHaveLength(1);
  });
});

describe("connexion Indy (A11)", () => {
  it("n'a aucune API vérifiée : état « API à vérifier », jamais un succès simulé", () => {
    expect(isIndyApiConfigured()).toBe(false);
    expect(INDY_CONNECTION_STATUS).toBe("to_verify");
    expect(() => assertIndyApiAvailable()).toThrow(ServiceUnavailableError);
  });
});
