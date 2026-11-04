import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "@/modules/crm/company.service";
import { MAX_IMPORT_ROWS, parseCsv } from "@/modules/crm/crm.import";
import { previewCompanyImport, runCompanyImportBatch } from "@/modules/crm/crm.import.service";
import * as s from "@/server/db/schema";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { auditCount, createWorld, uuid, type World } from "./world";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => w.close());

describe("lecture du fichier", () => {
  it("détecte le séparateur, les guillemets, les sauts de ligne et le BOM", () => {
    const table = parseCsv(
      '﻿Nom;Notes\r\n"Atelier ""Lune""";"Deux\nlignes"\r\n\r\nGarage;Simple\n',
    );
    expect(table.headers).toEqual(["Nom", "Notes"]);
    expect(table.rows).toEqual([
      { line: 2, cells: ['Atelier "Lune"', "Deux\nlignes"] },
      { line: 5, cells: ["Garage", "Simple"] },
    ]);
    expect(parseCsv("name,city\nA,B").rows[0]?.cells).toEqual(["A", "B"]);
  });
});

describe("aperçu", () => {
  it("classe chaque ligne sans rien écrire : prête, doublon, refusée", async () => {
    await createCompany(w.member, { name: "Déjà Là", domain: "deja-la.test" });
    const csv = [
      "Société;Domaine;Statut;Origine;SIREN;Téléphone;Ville;Tags;Prénom;Nom contact;E-mail;Poste;Colonne inconnue",
      "Nouvelle SARL;nouvelle.test;client;Réseau;111 222 333;06 12 34 56 78;Rouen;vitrine,local;Claire;Martin;claire@nouvelle.test;Gérante;x",
      "Autre SAS;;;;;;;;;;;;",
      "Copie;deja-la.test;;;;;;;;;;;",
      "déjà là;;;;;;;;;;;;",
      ";sans-nom.test;;;;;;;;;;;",
      "Mauvais;;inconnu;;12;abc;;;;;mauvais-email;;",
      "Interne 1;interne.test;;;;;;;;;;;",
      "Interne 2;interne.test;;;;;;;;;;;",
    ].join("\n");
    const before = await w.db.select().from(s.companies);
    const preview = await previewCompanyImport(w.member, { csv });
    expect(await w.db.select().from(s.companies)).toHaveLength(before.length);

    expect(preview.ignoredColumns).toEqual(["Colonne inconnue"]);
    const status = Object.fromEntries(preview.rows.map((row) => [row.line, row.status]));
    expect(status).toEqual({
      2: "ready",
      3: "ready",
      4: "duplicate",
      5: "duplicate",
      6: "rejected",
      7: "rejected",
      8: "ready",
      9: "duplicate",
    });
    expect(preview.ready).toBe(3);
    expect(preview.duplicates).toBe(3);
    expect(preview.rejected).toBe(2);
    const rejected = preview.rows.find((row) => row.line === 7);
    expect(rejected?.reasons.length).toBeGreaterThanOrEqual(3);
    expect(preview.rows.find((row) => row.line === 4)?.duplicateOf?.name).toBe("Déjà Là");
    expect(preview.rows.find((row) => row.line === 9)?.reasons[0]).toContain("ligne 8");
  });

  it("exige une colonne de nom et refuse un fichier trop long", async () => {
    await expect(
      previewCompanyImport(w.member, { csv: "Ville;Pays\nRouen;France" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const long = ["Nom", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `L${i}`)].join(
      "\n",
    );
    await expect(previewCompanyImport(w.member, { csv: long })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(previewCompanyImport(w.member, { csv: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("import", () => {
  const importId = uuid();
  const csv = [
    "Nom;Domaine;Statut;Prénom;Nom contact;E-mail;Téléphone contact",
    "Importée Un;importee-un.test;client;Anne;Durand;anne@importee.test;0612345678",
    "Importée Deux;;;;;;",
    "Importée Trois;;;Paul;Martin;paul@importee.test;",
  ].join("\n");

  it("crée client et contact dans Twenty et localement ; journalise le lot", async () => {
    const { results, stoppedBy } = await runCompanyImportBatch(w.member, {
      importId,
      csv,
      lines: [2, 3],
    });
    expect(stoppedBy).toBeNull();
    expect(results.map((row) => row.status)).toEqual(["created", "created"]);
    const [company] = await w.db
      .select()
      .from(s.companies)
      .where(eq(s.companies.name, "Importée Un"));
    expect(company?.status).toBe("client");
    expect(company?.domain).toBe("importee-un.test");
    const [contact] = await w.db
      .select()
      .from(s.contacts)
      .where(eq(s.contacts.companyId, company!.id));
    expect(contact).toMatchObject({
      firstName: "Anne",
      email: "anne@importee.test",
      phone: "+33612345678",
      isPrimary: true,
    });
    expect(w.crm.companies.has(company!.twentyId)).toBe(true);
    expect(w.crm.people.get(contact!.twentyId)?.companyId).toBe(company!.twentyId);
    expect(await auditCount(w.db, "crm.import_ran")).toBeGreaterThan(0);
  });

  it("se reprend sans doublon : la même ligne du même import ne crée rien", async () => {
    const { results } = await runCompanyImportBatch(w.member, { importId, csv, lines: [2] });
    expect(results[0]?.status).toBe("already");
    const rows = await w.db.select().from(s.companies).where(eq(s.companies.name, "Importée Un"));
    expect(rows).toHaveLength(1);
  });

  it("s'arrête à la coupure de Twenty, puis reprend", async () => {
    const id = uuid();
    const file = ["Nom", "Coupure Un", "Coupure Deux", "Coupure Trois"].join("\n");
    w.crm.simulateOutage();
    const interrupted = await runCompanyImportBatch(w.member, {
      importId: id,
      csv: file,
      lines: [2, 3, 4],
    });
    expect(interrupted.stoppedBy).toBeTruthy();
    expect(interrupted.results).toHaveLength(0);
    w.crm.endOutage();
    const resumed = await runCompanyImportBatch(w.member, {
      importId: id,
      csv: file,
      lines: [2, 3, 4],
    });
    expect(resumed.stoppedBy).toBeNull();
    expect(resumed.results.map((row) => row.status)).toEqual(["created", "created", "created"]);
  });

  it("refuse une ligne invalide et rapporte un doublon survenu entre l'aperçu et l'import", async () => {
    const id = uuid();
    const file = ["Nom;Domaine", ";sans-nom.test", "Tardive;tardive.test"].join("\n");
    await createCompany(w.member, { name: "Arrivée avant", domain: "tardive.test" });
    const { results } = await runCompanyImportBatch(w.member, {
      importId: id,
      csv: file,
      lines: [2, 3],
    });
    expect(results.map((row) => row.status)).toEqual(["failed", "duplicate"]);
  });

  it("garde le client si le contact est refusé, et le dit", async () => {
    const id = uuid();
    await w.crm.createPerson({
      id: uuid(),
      firstName: "Occupe",
      lastName: "Adresse",
      emails: { primary: "occupe@test.test", additional: [] },
    });
    const file = ["Nom;Nom contact;E-mail", "Client seul;X;occupe@test.test"].join("\n");
    const { results } = await runCompanyImportBatch(w.member, {
      importId: id,
      csv: file,
      lines: [2],
    });
    expect(results[0]?.status).toBe("created");
    expect(results[0]?.message).toContain("contact refusé");
  });

  it("réservé à crm:create", async () => {
    await expect(previewCompanyImport(w.viewer, { csv: "Nom\nA" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      runCompanyImportBatch(w.contractor, { importId: uuid(), csv: "Nom\nA", lines: [2] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
