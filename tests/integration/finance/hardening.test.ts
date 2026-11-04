import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsvKind, parseCsvStatus } from "@/integrations/indy/indy.csv";
import { exportFinanceCsv } from "@/modules/finance/finance.export";
import {
  changeInvoiceStatus,
  createDirectCost,
  createInvoiceReference,
  createScheduleItem,
  deleteDirectCost,
  deleteScheduleItem,
  getCompanyLinks,
  getDirectCost,
  getFinanceFormOptions,
  getFinanceSummary,
  getInvoice,
  getRecurringOverview,
  getScheduleDetail,
  listDirectCosts,
  listInvoices,
  listSchedule,
  setInvoiceClientVisibility,
  updateDirectCost,
  updateInvoiceReference,
  updateScheduleItem,
} from "@/modules/finance/finance.service";
import {
  getImportReport,
  listImportHistory,
  previewInvoiceImport,
  runInvoiceImport,
} from "@/modules/finance/import.service";
import {
  getMarginForActor,
  getProfitabilityOverview,
  listProfitability,
  type MarginScope,
} from "@/modules/finance/profitability.service";
import type { ServiceContext } from "@/server/context";
import {
  auditLog,
  financialDocuments,
  paymentScheduleItems,
  teamMembers,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createCompany, createProject, createTeamMember } from "../../helpers/factories";

const NOW = new Date("2026-11-04T12:00:00Z");
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let issuer: string;
let counter = 0;
const nextRef = () => `HARD-${(counter += 1)}`;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createTestContext(db, "admin");
  issuer = (await createTeamMember(db, { kind: "partner", fullName: "Ethan Ngo" })).id;
});
afterAll(async () => close());

function invoiceInput(companyId: string, overrides: Record<string, unknown> = {}) {
  return {
    companyId,
    externalRef: nextRef(),
    issuerMemberId: issuer,
    issuedOn: "2026-10-20",
    dueOn: "2026-11-30",
    amountCents: "100000",
    taxCents: "20000",
    ...overrides,
  };
}

const scheduleInput = (companyId: string, amountCents = "100000") => ({
  companyId,
  label: "Acompte",
  dueOn: "2026-12-01",
  amountCents,
});

const csvFile = (lines: string[]) => ({
  filename: "indy.csv",
  bytes: new TextEncoder().encode(lines.join("\n")),
});
const HEADER = "Numéro;Client;Montant HT;TVA;Date;Échéance;État;Payée le;Émise par";
const MAPPING = {
  externalRef: "Numéro",
  company: "Client",
  amountHt: "Montant HT",
  tax: "TVA",
  issuedOn: "Date",
  dueOn: "Échéance",
  status: "État",
  paidOn: "Payée le",
  issuer: "Émise par",
};

describe("exports CSV", () => {
  it("garde un montant négatif calculable : pas d'apostrophe sur un avoir", async () => {
    const company = await createCompany(db);
    const ref = nextRef();
    await createInvoiceReference(
      admin,
      invoiceInput(company.id, { externalRef: ref, kind: "credit_note", amountCents: "50000" }),
      NOW,
    );
    const { csv } = await exportFinanceCsv(admin, "factures", { now: NOW });
    const line = csv.split("\r\n").find((row) => row.startsWith(ref));
    expect(line).toContain(";-500,00;");
    expect(line).not.toContain("'-");
  });

  it("neutralise toujours une formule qui commence par un moins", async () => {
    const company = await createCompany(db, { name: "-2+3" });
    await createInvoiceReference(admin, invoiceInput(company.id), NOW);
    const { csv } = await exportFinanceCsv(admin, "factures", { now: NOW });
    expect(csv).toContain("'-2+3");
  });
});

describe("changement de client", () => {
  it("une échéance qui a porté une facture annulée garde son client, avec un refus lisible", async () => {
    const [first, second] = [await createCompany(db), await createCompany(db)];
    const item = await createScheduleItem(admin, scheduleInput(first.id));
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(first.id, { scheduleItemId: item.id }),
      NOW,
    );
    await changeInvoiceStatus(admin, invoice.id, { to: "cancelled" }, NOW);
    await expect(updateScheduleItem(admin, item.id, scheduleInput(second.id))).rejects.toThrow(
      ConflictError,
    );
  });

  it("déplacer vers un autre client la facture principale d'une échéance la détache proprement", async () => {
    const [first, second] = [await createCompany(db), await createCompany(db)];
    const item = await createScheduleItem(admin, scheduleInput(first.id));
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(first.id, { scheduleItemId: item.id }),
      NOW,
    );
    const updated = await updateInvoiceReference(
      admin,
      invoice.id,
      invoiceInput(second.id, { externalRef: invoice.externalRef }),
      NOW,
    );
    expect(updated.companyId).toBe(second.id);
    const [row] = await db
      .select()
      .from(paymentScheduleItems)
      .where(eq(paymentScheduleItems.id, item.id));
    expect(row?.status).toBe("planned");
    expect(row?.financialDocumentId).toBeNull();
  });
});

describe("import d'un fichier Indy", () => {
  it("ne modifie pas une facture annulée, même sans colonne d'état", async () => {
    const company = await createCompany(db, { name: "Annulée SARL" });
    const ref = nextRef();
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { externalRef: ref }),
      NOW,
    );
    await changeInvoiceStatus(admin, invoice.id, { to: "cancelled" }, NOW);
    const result = await runInvoiceImport(
      admin,
      csvFile(["Numéro;Client;Montant HT;Date", `${ref};Annulée SARL;999,00;20/10/2026`]),
      { externalRef: "Numéro", company: "Client", amountHt: "Montant HT", issuedOn: "Date" },
      NOW,
    );
    expect(result.rejected).toBe(1);
    expect(result.updated).toBe(0);
    const [row] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.id, invoice.id));
    expect(row?.amountCents).toBe(100000);
    expect(row?.status).toBe("cancelled");
  });

  it("un paiement retiré dans Indy, échéance passée : la facture revient en retard", async () => {
    const company = await createCompany(db, { name: "Retour SARL" });
    const ref = nextRef();
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { externalRef: ref, issuedOn: "2026-09-01", dueOn: "2026-10-01" }),
      NOW,
    );
    await changeInvoiceStatus(admin, invoice.id, { to: "paid", paidOn: "2026-10-15" }, NOW);
    const result = await runInvoiceImport(
      admin,
      csvFile([
        HEADER,
        `${ref};Retour SARL;1000,00;200,00;01/09/2026;01/10/2026;Envoyée;;Ethan Ngo`,
      ]),
      MAPPING,
      NOW,
    );
    expect(result.rejected).toBe(0);
    expect(result.updated).toBe(1);
    const [row] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.id, invoice.id));
    expect(row?.status).toBe("overdue");
    expect(row?.paidOn).toBeNull();
  });

  it("trace chaque ligne mise à jour, montant avant et après", async () => {
    const company = await createCompany(db, { name: "Trace SARL" });
    const ref = nextRef();
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { externalRef: ref }),
      NOW,
    );
    await runInvoiceImport(
      admin,
      csvFile([HEADER, `${ref};Trace SARL;1500,00;300,00;20/10/2026;30/11/2026;;;Ethan Ngo`]),
      MAPPING,
      NOW,
    );
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "financial_document.updated"), eq(auditLog.entityId, invoice.id)),
      )
      .orderBy(desc(auditLog.occurredAt))
      .limit(1);
    expect(entry?.metadata).toMatchObject({
      fromCents: 100000,
      toCents: 150000,
      source: "indy_csv",
    });
  });

  it("un état ou un type nommé comme une propriété d'objet reste inconnu", () => {
    expect(parseCsvStatus("constructor")).toBeNull();
    expect(parseCsvKind("constructor")).toBeNull();
    expect(parseCsvStatus("toString")).toBeNull();
  });

  it("refuse un émetteur qui n'est pas associé", async () => {
    await createCompany(db, { name: "Emetteur SARL" });
    await createTeamMember(db, { kind: "contractor", fullName: "Paul Prestataire" });
    const result = await runInvoiceImport(
      admin,
      csvFile([
        HEADER,
        `${nextRef()};Emetteur SARL;100,00;20,00;20/10/2026;30/11/2026;;;Paul Prestataire`,
      ]),
      MAPPING,
      NOW,
    );
    expect(result.rejected).toBe(1);
    expect(result.rejections[0]?.message).toContain("Émetteur");
  });
});

describe("émetteur et intervenant", () => {
  it("n'accepte qu'un associé actif comme émetteur (A12)", async () => {
    const company = await createCompany(db);
    const contractor = await createTeamMember(db, { kind: "contractor" });
    const archived = await createTeamMember(db, { kind: "partner" });
    await db.update(teamMembers).set({ archivedAt: NOW }).where(eq(teamMembers.id, archived.id));
    for (const issuerMemberId of [contractor.id, archived.id, UNKNOWN_ID]) {
      const failure = await createInvoiceReference(
        admin,
        invoiceInput(company.id, { issuerMemberId }),
        NOW,
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ValidationError);
      expect((failure as ValidationError).fieldErrors?.issuerMemberId).toBeDefined();
    }
  });

  it("garde l'émetteur déjà posé sur une facture quand on la modifie", async () => {
    const company = await createCompany(db);
    const formerPartner = await createTeamMember(db, { kind: "partner" });
    const invoice = await createInvoiceReference(
      admin,
      invoiceInput(company.id, { issuerMemberId: formerPartner.id }),
      NOW,
    );
    await db
      .update(teamMembers)
      .set({ archivedAt: NOW })
      .where(eq(teamMembers.id, formerPartner.id));
    const updated = await updateInvoiceReference(
      admin,
      invoice.id,
      invoiceInput(company.id, {
        externalRef: invoice.externalRef,
        issuerMemberId: formerPartner.id,
        amountCents: "120000",
      }),
      NOW,
    );
    expect(updated.amountCents).toBe(120000);
  });

  it("le formulaire propose les associés comme émetteurs, tout le monde comme intervenant", async () => {
    const contractor = await createTeamMember(db, { kind: "contractor" });
    const options = await getFinanceFormOptions(admin);
    expect(options.issuers.map((row) => row.id)).toContain(issuer);
    expect(options.issuers.map((row) => row.id)).not.toContain(contractor.id);
    expect(options.members.map((row) => row.id)).toContain(contractor.id);
  });

  it("refuse un intervenant inconnu sur un coût, sans erreur technique", async () => {
    const failure = await createDirectCost(admin, {
      label: "Sous-traitance",
      category: "subcontracting",
      amountCents: "1000",
      incurredOn: "2026-01-01",
      nature: "actual",
      memberId: UNKNOWN_ID,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationError);
  });
});

describe("revenus certains", () => {
  it("compte ce qu'il reste à facturer d'une échéance à moitié facturée (co-traitance)", async () => {
    const before = await getFinanceSummary(db, { from: "2026-11-01", to: "2026-11-30" }, NOW);
    const company = await createCompany(db);
    const item = await createScheduleItem(admin, scheduleInput(company.id, "200000"));
    await createInvoiceReference(
      admin,
      invoiceInput(company.id, { scheduleItemId: item.id, amountCents: "120000" }),
      NOW,
    );
    const after = await getFinanceSummary(db, { from: "2026-11-01", to: "2026-11-30" }, NOW);
    expect(after.plannedScheduleCents - before.plannedScheduleCents).toBe(80000);
    expect(after.outstandingCents - before.outstandingCents).toBe(120000);
  });
});

describe("identifiants et entrées d'URL", () => {
  it("un identifiant mal formé répond 404 sur chaque écriture, jamais une erreur SQL", async () => {
    const company = await createCompany(db);
    const cost = {
      label: "x",
      category: "other",
      amountCents: "1",
      incurredOn: "2026-01-01",
      nature: "actual",
    };
    const calls = [
      () => updateInvoiceReference(admin, "pas-un-id", invoiceInput(company.id), NOW),
      () => changeInvoiceStatus(admin, "pas-un-id", { to: "paid" }, NOW),
      () => setInvoiceClientVisibility(admin, "pas-un-id", true),
      () => updateScheduleItem(admin, "pas-un-id", scheduleInput(company.id)),
      () => deleteScheduleItem(admin, "pas-un-id"),
      () => updateDirectCost(admin, "pas-un-id", cost),
      () => deleteDirectCost(admin, "pas-un-id"),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(NotFoundError);
  });

  it("la portée et l'identifiant d'une marge ne cassent pas l'écran", async () => {
    await expect(
      getMarginForActor(admin, { scope: "project", id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      getMarginForActor(admin, { scope: "project", id: "-".repeat(36) }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      listProfitability(admin, "constructor" as MarginScope, null, { page: 1, pageSize: 5 }, NOW),
    ).rejects.toThrow(ValidationError);
  });

  it("une recherche trop longue dans l'URL se tronque au lieu de faire tomber l'écran", async () => {
    const search = "x".repeat(300);
    const PAGE = { page: 1, pageSize: 5 };
    await expect(listInvoices(admin, { search }, PAGE, NOW)).resolves.toMatchObject({ total: 0 });
    await expect(listSchedule(admin, { search }, PAGE)).resolves.toMatchObject({ total: 0 });
    await expect(listDirectCosts(admin, { search }, PAGE)).resolves.toMatchObject({ total: 0 });
  });

  it("la visibilité client n'accepte qu'un booléen", async () => {
    const company = await createCompany(db);
    const invoice = await createInvoiceReference(admin, invoiceInput(company.id), NOW);
    await expect(
      setInvoiceClientVisibility(admin, invoice.id, "oui" as unknown as boolean),
    ).rejects.toThrow(ValidationError);
  });
});

describe("rentabilité par projet", () => {
  it("nomme le projet, pas son client : deux projets d'un client restent distincts", async () => {
    const company = await createCompany(db, { name: "Double SARL" });
    const first = await createProject(db, { companyId: company.id, name: "Refonte du site" });
    const second = await createProject(db, { companyId: company.id, name: "Boutique en ligne" });
    const page = await listProfitability(
      admin,
      "project",
      "Double SARL",
      { page: 1, pageSize: 10 },
      NOW,
    );
    const titles = new Map(page.items.map((row) => [row.id, row.title]));
    expect(titles.get(first.id)).toBe("Refonte du site");
    expect(titles.get(second.id)).toBe("Boutique en ligne");
    expect(page.items[0]?.subtitle).toBe("Double SARL");
  });
});

describe("journal", () => {
  it("garde le montant et le client avant et après une modification de facture", async () => {
    const [first, second] = [await createCompany(db), await createCompany(db)];
    const invoice = await createInvoiceReference(admin, invoiceInput(first.id), NOW);
    await updateInvoiceReference(
      admin,
      invoice.id,
      invoiceInput(second.id, { externalRef: invoice.externalRef, amountCents: "130000" }),
      NOW,
    );
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "financial_document.updated"), eq(auditLog.entityId, invoice.id)),
      )
      .limit(1);
    expect(entry?.metadata).toMatchObject({
      fromCents: 100000,
      toCents: 130000,
      fromCompanyId: first.id,
      toCompanyId: second.id,
    });
  });

  it("garde le montant avant et après une modification d'échéance", async () => {
    const company = await createCompany(db);
    const item = await createScheduleItem(admin, scheduleInput(company.id, "100000"));
    await updateScheduleItem(admin, item.id, scheduleInput(company.id, "150000"));
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "schedule_item.updated"), eq(auditLog.entityId, item.id)))
      .limit(1);
    expect(entry?.metadata).toMatchObject({ fromCents: 100000, toCents: 150000 });
  });
});

describe("droits, fonction par fonction", () => {
  const PAGE = { page: 1, pageSize: 5 };
  const file = { filename: "a.csv", bytes: new TextEncoder().encode("a;b\n1;2\n") };

  it.each(["member", "contractor", "viewer"] as const)(
    "le rôle %s n'atteint aucune lecture ni écriture du lot",
    async (role) => {
      const ctx = await createTestContext(db, role);
      const company = await createCompany(db);
      const invoice = await createInvoiceReference(admin, invoiceInput(company.id), NOW);
      const item = await createScheduleItem(admin, scheduleInput(company.id));
      const cost = await createDirectCost(admin, {
        label: "Coût",
        category: "other",
        amountCents: "100",
        incurredOn: "2026-01-01",
        nature: "actual",
      });
      const costInput = {
        label: "x",
        category: "other",
        amountCents: "1",
        incurredOn: "2026-01-01",
        nature: "actual",
      };
      const calls: (() => Promise<unknown>)[] = [
        () => getInvoice(ctx, invoice.id, NOW),
        () => updateInvoiceReference(ctx, invoice.id, invoiceInput(company.id), NOW),
        () => changeInvoiceStatus(ctx, invoice.id, { to: "paid" }, NOW),
        () => setInvoiceClientVisibility(ctx, invoice.id, true),
        () => listSchedule(ctx, {}, PAGE),
        () => getScheduleDetail(ctx, item.id, NOW),
        () => createScheduleItem(ctx, scheduleInput(company.id)),
        () => updateScheduleItem(ctx, item.id, scheduleInput(company.id)),
        () => deleteScheduleItem(ctx, item.id),
        () => listDirectCosts(ctx, {}, PAGE),
        () => getDirectCost(ctx, cost.id),
        () => updateDirectCost(ctx, cost.id, costInput),
        () => deleteDirectCost(ctx, cost.id),
        () => getRecurringOverview(ctx),
        () => getFinanceFormOptions(ctx),
        () => getCompanyLinks(ctx, company.id),
        () => previewInvoiceImport(ctx, file),
        () => runInvoiceImport(ctx, file, undefined, NOW),
        () => listImportHistory(ctx, PAGE),
        () => getImportReport(ctx, UNKNOWN_ID),
        () => exportFinanceCsv(ctx, "factures"),
        () => getMarginForActor(ctx, { scope: "client", id: company.id }),
        () => listProfitability(ctx, "project", null, PAGE, NOW),
        () => getProfitabilityOverview(ctx, NOW),
      ];
      for (const call of calls) await expect(call()).rejects.toThrow(ForbiddenError);
    },
  );
});
