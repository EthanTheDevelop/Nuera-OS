import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeCsvBytes,
  parseCsv,
  parseCsvAmount,
  parseCsvDate,
  parseCsvSiren,
  parseCsvStatus,
  suggestMapping,
} from "@/integrations/indy/indy.csv";
import { exportFinanceCsv } from "@/modules/finance/finance.export";
import { escapeCsvCell, toCsv } from "@/modules/finance/finance.csv";
import { createInvoiceReference } from "@/modules/finance/finance.service";
import {
  getImportReport,
  listImportHistory,
  previewInvoiceImport,
  runInvoiceImport,
} from "@/modules/finance/import.service";
import type { ServiceContext } from "@/server/context";
import {
  auditLog,
  domainEvents,
  financeImports,
  financialDocuments,
  integrationConnections,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createCompany, createProject, createTeamMember } from "../../helpers/factories";

const NOW = new Date("2026-11-04T12:00:00Z");

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createTestContext(db, "admin");
  await createCompany(db, { name: "Atelier Lune", siren: "123456789" });
  await createCompany(db, { name: "Bistrot du Port" });
  await createTeamMember(db, { fullName: "Ethan Ngo", email: "ethan@test.local", kind: "partner" });
});
afterAll(async () => close());

const file = (csv: string, filename = "factures.csv") => ({
  filename,
  bytes: new TextEncoder().encode(csv),
});

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

const HEADER = "Numéro;Client;Montant HT;TVA;Date;Échéance;État;Payée le;Émise par";

describe("lecture du fichier", () => {
  it("gère guillemets, retours à la ligne, BOM et séparateur", () => {
    const parsed = parseCsv('﻿Ref;Client\r\nA;"Dupont ; fils"\r\n\r\nB;"Sur\ndeux lignes"\r\n');
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Ref", "Client"]);
    expect(parsed.records.map((record) => record.cells[1])).toEqual([
      "Dupont ; fils",
      "Sur\ndeux lignes",
    ]);
    // La ligne vide n'est pas un enregistrement, mais les numéros restent ceux du fichier.
    expect(parsed.records.map((record) => record.line)).toEqual([2, 4]);
    expect(parseCsv("a,b,c\n1,2,3").delimiter).toBe(",");
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
  });

  it("décode l'UTF-8, sinon le Windows-1252 d'Excel", () => {
    expect(decodeCsvBytes(new TextEncoder().encode("Échéance"))).toBe("Échéance");
    expect(decodeCsvBytes(new Uint8Array([0xc9, 0x63, 0x68]))).toBe("Éch");
  });

  it("lit montants, dates, états et SIREN, et refuse ce qui est ambigu", () => {
    expect(parseCsvAmount("1 234,50 €")).toBe(123450);
    expect(parseCsvAmount("1234.5")).toBe(123450);
    expect(parseCsvAmount("-100,00")).toBe(-10000);
    expect(parseCsvAmount("1,234.50")).toBeNull();
    expect(parseCsvAmount("abc")).toBeNull();
    expect(parseCsvDate("31/12/2026")).toBe("2026-12-31");
    expect(parseCsvDate("31-12-26")).toBe("2026-12-31");
    expect(parseCsvDate("2026-12-31")).toBe("2026-12-31");
    expect(parseCsvDate("31/02/2026")).toBeNull();
    expect(parseCsvStatus("Payée")).toBe("paid");
    expect(parseCsvStatus("En attente de paiement")).toBe("issued");
    expect(parseCsvStatus("EN RETARD")).toBe("overdue");
    expect(parseCsvStatus("bizarre")).toBeNull();
    expect(parseCsvSiren("123 456 789 00012")).toBe("123456789");
    expect(parseCsvSiren("12")).toBeNull();
  });

  it("suggère une association de colonnes sans jamais donner deux champs à une colonne", () => {
    const mapping = suggestMapping([
      "N° de facture",
      "Client",
      "Total HT",
      "Total TTC",
      "Date d'émission",
      "Échéance",
    ]);
    expect(mapping).toMatchObject({
      externalRef: "N° de facture",
      company: "Client",
      amountHt: "Total HT",
      amountTtc: "Total TTC",
      issuedOn: "Date d'émission",
      dueOn: "Échéance",
    });
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("aperçu", () => {
  it("n'écrit rien et annonce, ligne par ligne, ce qui serait fait", async () => {
    const csv = [
      HEADER,
      "P-1;Atelier Lune;1000,00;200,00;01/10/2026;30/11/2026;Envoyée;;Ethan Ngo",
      "P-2;Client Inconnu;1000,00;200,00;01/10/2026;30/11/2026;Envoyée;;Ethan Ngo",
    ].join("\n");
    const before = await db.$count(financialDocuments);
    const preview = await previewInvoiceImport(admin, file(csv), MAPPING, NOW);
    expect(preview).toMatchObject({ total: 2, creates: 1, rejected: 1, missingFields: [] });
    expect(preview.rows[0]).toMatchObject({ action: "reject", line: 3 });
    expect(preview.rows[0]?.errors[0]).toContain("Client introuvable");
    expect(await db.$count(financialDocuments)).toBe(before);
  });

  it("sans association fournie, propose celle déduite des en-têtes", async () => {
    const preview = await previewInvoiceImport(
      admin,
      file("Numéro;Client;Montant HT;Date\nP-9;Atelier Lune;10;01/10/2026"),
      undefined,
      NOW,
    );
    expect(preview.mapping).toMatchObject({ externalRef: "Numéro", amountHt: "Montant HT" });
    expect(preview.missingFields).toEqual([]);
  });

  it("signale les champs obligatoires sans colonne", async () => {
    const preview = await previewInvoiceImport(admin, file("Foo;Bar\n1;2"), {}, NOW);
    expect(preview.missingFields).toHaveLength(4);
    await expect(runInvoiceImport(admin, file("Foo;Bar\n1;2"), {}, NOW)).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuse un fichier vide, une colonne absente du fichier", async () => {
    await expect(previewInvoiceImport(admin, file(""), undefined, NOW)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      previewInvoiceImport(admin, file("A;B\n1;2"), { externalRef: "Absente" }, NOW),
    ).rejects.toThrow(ValidationError);
  });
});

describe("import", () => {
  const CSV = [
    HEADER,
    "F-E-1;Atelier Lune;1170,00;234,00;01/10/2026;30/11/2026;Payée;15/10/2026;Ethan Ngo",
    "F-E-2;Atelier Lune;1592,00;318,40;01/10/2026;30/11/2026;Envoyée;;Ethan Ngo",
    "F-E-3;Bistrot du Port;650,00;130,00;01/08/2026;01/09/2026;Envoyée;;Ethan",
    "F-E-4;Client Inconnu;10,00;2,00;01/10/2026;30/11/2026;Envoyée;;Ethan",
    "F-E-5;Atelier Lune;abc;2,00;01/10/2026;30/11/2026;Envoyée;;Ethan",
    "F-E-6;Atelier Lune;10,00;2,00;31/02/2026;30/11/2026;Envoyée;;Ethan",
    "F-E-7;Atelier Lune;10,00;2,00;01/10/2026;30/11/2026;Inconnu;;Ethan",
    "F-E-8;Atelier Lune;10,00;2,00;01/10/2026;30/11/2026;Envoyée;;Personne",
    "F-E-1;Atelier Lune;10,00;2,00;01/10/2026;30/11/2026;Envoyée;;Ethan",
    "F-E-9;Atelier Lune;10,00;2,00;01/10/2026;30/11/2026;Payée;;Ethan",
  ].join("\n");

  it("crée ce qui est valide, rapporte chaque refus, journalise et renseigne la connexion", async () => {
    const result = await runInvoiceImport(admin, file(CSV), MAPPING, NOW);
    expect(result).toMatchObject({ total: 10, created: 3, updated: 0, unchanged: 0, rejected: 7 });
    expect(result.rejections.map((row) => row.line)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(result.rejections.find((row) => row.line === 10)?.message).toContain("double");
    expect(result.rejections.find((row) => row.line === 11)?.message).toContain(
      "sans date de paiement",
    );

    const [paid] = await db
      .select()
      .from(financialDocuments)
      .where(
        and(eq(financialDocuments.source, "indy_csv"), eq(financialDocuments.externalRef, "F-E-1")),
      );
    expect(paid).toMatchObject({
      status: "paid",
      paidOn: "2026-10-15",
      amountCents: 117000,
      taxCents: 23400,
    });
    expect(paid?.importedAt).not.toBeNull();

    const [late] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.externalRef, "F-E-3"));
    expect(late?.status).toBe("overdue");

    const report = await getImportReport(admin, result.importId);
    expect(report.rowsRejected).toBe(7);
    expect(report.rejections).toHaveLength(7);

    const [connection] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.service, "indy"));
    expect(connection).toMatchObject({ status: "to_verify" });
    expect(connection?.lastSuccessAt).toEqual(NOW);

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "finance.import_ran"), eq(auditLog.entityId, result.importId)),
      );
    expect(audit).toHaveLength(1);
  });

  it("rejouer le même fichier ne change rien et n'émet rien de plus", async () => {
    const eventsBefore = await db.$count(domainEvents);
    const documentsBefore = await db.$count(financialDocuments);
    const again = await runInvoiceImport(admin, file(CSV), MAPPING, NOW);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 3, rejected: 7 });
    expect(await db.$count(financialDocuments)).toBe(documentsBefore);
    expect(await db.$count(domainEvents)).toBe(eventsBefore);
    expect(await db.$count(financeImports)).toBe(2);
  });

  it("un état mis à jour dans Indy passe par la machine et n'alerte qu'une fois", async () => {
    const csv = [
      HEADER,
      "F-E-2;Atelier Lune;1592,00;318,40;01/10/2026;30/11/2026;Payée;03/11/2026;Ethan Ngo",
    ].join("\n");
    const result = await runInvoiceImport(admin, file(csv), MAPPING, NOW);
    expect(result).toMatchObject({ updated: 1, created: 0 });
    await runInvoiceImport(admin, file(csv), MAPPING, NOW);
    const [row] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.externalRef, "F-E-2"));
    expect(row).toMatchObject({ status: "paid", paidOn: "2026-11-03" });
    const events = await db
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.type, "invoice.paid"), eq(domainEvents.entityId, row?.id ?? "")));
    expect(events).toHaveLength(1);
  });

  it("refuse un passage impossible, ligne par ligne, sans bloquer le reste", async () => {
    const company = await createCompany(db, { name: "Passages" });
    const csv = [
      HEADER,
      "X-1;Passages;10,00;2,00;01/10/2026;30/11/2026;Annulée;;",
      "X-2;Passages;10,00;2,00;01/10/2026;30/11/2026;Envoyée;;",
    ].join("\n");
    await runInvoiceImport(admin, file(csv), MAPPING, NOW);
    const next = [
      HEADER,
      "X-1;Passages;10,00;2,00;01/10/2026;30/11/2026;Payée;01/11/2026;",
      "X-2;Passages;20,00;2,00;01/10/2026;30/11/2026;Envoyée;;",
    ].join("\n");
    const result = await runInvoiceImport(admin, file(next), MAPPING, NOW);
    expect(result).toMatchObject({ rejected: 1, updated: 1 });
    expect(result.rejections[0]?.message).toContain("impossible");
    expect(company.id).toBeTruthy();
  });

  it("une référence saisie à la main se rapproche de sa ligne : pas de doublon de revenu", async () => {
    const company = await createCompany(db, { name: "Rapprochement" });
    const member = await createTeamMember(db, { kind: "partner", fullName: "Autre Associée" });
    const manual = await createInvoiceReference(
      admin,
      {
        companyId: company.id,
        externalRef: "R-1",
        issuerMemberId: member.id,
        issuedOn: "2026-10-01",
        dueOn: "2026-12-01",
        amountCents: "10000",
      },
      NOW,
    );
    const csv = [
      HEADER,
      "R-1;Rapprochement;100,00;20,00;01/10/2026;01/12/2026;Payée;02/11/2026;",
    ].join("\n");
    const result = await runInvoiceImport(admin, file(csv), MAPPING, NOW);
    expect(result).toMatchObject({ created: 0, updated: 1 });
    const rows = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.externalRef, "R-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: manual.id,
      source: "manual",
      status: "paid",
      taxCents: 2000,
    });
    // Cette colonne n'était pas renseignée : l'émetteur saisi reste.
    expect(rows[0]?.issuerMemberId).toBe(member.id);
  });

  it("une référence d'un autre client est refusée, jamais déplacée", async () => {
    await createCompany(db, { name: "Voleur" });
    const csv = [
      HEADER,
      "F-E-1;Voleur;1170,00;234,00;01/10/2026;30/11/2026;Payée;15/10/2026;",
    ].join("\n");
    const result = await runInvoiceImport(admin, file(csv), MAPPING, NOW);
    expect(result).toMatchObject({ rejected: 1, updated: 0 });
    expect(result.rejections[0]?.message).toContain("autre client");
  });

  it("rattache un projet du même client, refuse celui d'un autre", async () => {
    const [mine, other] = [
      await createCompany(db, { name: "Avec Projet" }),
      await createCompany(db, { name: "Autre Projet" }),
    ];
    const project = await createProject(db, { companyId: mine.id, number: "P-2026-901" });
    const foreign = await createProject(db, { companyId: other.id, number: "P-2026-902" });
    const csv = [
      "Numéro;Client;Montant HT;Date;Projet",
      `G-1;Avec Projet;10,00;01/10/2026;${project.number}`,
      `G-2;Avec Projet;10,00;01/10/2026;${foreign.number}`,
    ].join("\n");
    const result = await runInvoiceImport(
      admin,
      file(csv),
      {
        externalRef: "Numéro",
        company: "Client",
        amountHt: "Montant HT",
        issuedOn: "Date",
        project: "Projet",
      },
      NOW,
    );
    expect(result).toMatchObject({ created: 1, rejected: 1 });
    const [row] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.externalRef, "G-1"));
    expect(row?.projectId).toBe(project.id);
  });

  it("le SIREN prime sur le nom ; un montant négatif devient un avoir", async () => {
    const csv = [
      "Numéro;Client;SIREN;Montant HT;Date",
      "H-1;Mauvais nom;123 456 789;-50,00;01/10/2026",
    ].join("\n");
    const result = await runInvoiceImport(
      admin,
      file(csv),
      {
        externalRef: "Numéro",
        company: "Client",
        siren: "SIREN",
        amountHt: "Montant HT",
        issuedOn: "Date",
      },
      NOW,
    );
    expect(result.created).toBe(1);
    const [row] = await db
      .select()
      .from(financialDocuments)
      .where(eq(financialDocuments.externalRef, "H-1"));
    expect(row).toMatchObject({ kind: "credit_note", amountCents: -5000 });
  });

  it("déduit le HT du TTC et de la TVA, jamais du TTC seul", async () => {
    const withTax = await previewInvoiceImport(
      admin,
      file("Numéro;Client;TTC;TVA;Date\nJ-1;Atelier Lune;120,00;20,00;01/10/2026"),
      { externalRef: "Numéro", company: "Client", amountTtc: "TTC", tax: "TVA", issuedOn: "Date" },
      NOW,
    );
    expect(withTax.rows[0]).toMatchObject({ action: "create", amountCents: 10000 });
    const ttcOnly = await previewInvoiceImport(
      admin,
      file("Numéro;Client;TTC;Date\nJ-2;Atelier Lune;120,00;01/10/2026"),
      { externalRef: "Numéro", company: "Client", amountTtc: "TTC", issuedOn: "Date" },
      NOW,
    );
    expect(ttcOnly.missingFields).toContain("Montant HT (ou TTC et TVA)");
  });
});

describe("historique et droits", () => {
  it("l'historique est paginé, un import inconnu répond 404", async () => {
    const page = await listImportHistory(admin, { page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);
    await expect(getImportReport(admin, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("seul un associé importe, voit l'historique et exporte", async () => {
    for (const role of ["member", "contractor", "viewer"] as const) {
      const ctx = await createTestContext(db, role);
      await expect(previewInvoiceImport(ctx, file("A\n1"), undefined, NOW)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(runInvoiceImport(ctx, file("A\n1"), {}, NOW)).rejects.toThrow(ForbiddenError);
      await expect(listImportHistory(ctx, { page: 1, pageSize: 1 })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(exportFinanceCsv(ctx, "factures")).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("export CSV", () => {
  it("échappe les cellules et neutralise les formules", () => {
    expect(escapeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell('a;"b"')).toBe('"a;""b"""');
    expect(escapeCsvCell(null)).toBe("");
    expect(toCsv(["A"], [[1.5]])).toBe("﻿A\r\n1,5\r\n");
  });

  it("produit chaque jeu de données et trace l'export", async () => {
    for (const dataset of [
      "factures",
      "echeancier",
      "couts",
      "rentabilite-projets",
      "rentabilite-clients",
      "rentabilite-sites",
      "rentabilite-contrats",
    ]) {
      const result = await exportFinanceCsv(admin, dataset, { now: NOW });
      expect(result.filename).toBe(`nuera-${dataset}-2026-11-04.csv`);
      expect(result.csv.startsWith("﻿")).toBe(true);
    }
    const invoices = await exportFinanceCsv(admin, "factures", { now: NOW });
    expect(invoices.csv).toContain("F-E-1");
    expect(invoices.csv).toContain("1170,00");
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "export.run"));
    expect(audits.length).toBeGreaterThanOrEqual(7);
  });

  it("le rapport d'un import se télécharge ; un jeu inconnu est refusé", async () => {
    const [last] = await listImportHistory(admin, { page: 1, pageSize: 50 }).then((page) =>
      page.items.filter((row) => row.rowsRejected > 0),
    );
    const report = await exportFinanceCsv(admin, "rapport-import", {
      importId: last?.id,
      now: NOW,
    });
    expect(report.csv).toContain("Motif du refus");
    await expect(exportFinanceCsv(admin, "inconnu")).rejects.toThrow(ValidationError);
    await expect(exportFinanceCsv(admin, "rapport-import")).rejects.toThrow(ValidationError);
  });
});
