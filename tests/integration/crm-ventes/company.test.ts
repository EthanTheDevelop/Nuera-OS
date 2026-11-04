import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveCompany,
  createCompany,
  getCompany,
  getCompanySummary,
  listCompanies,
  listCompanyDuplicates,
  mergeCompanies,
  restoreCompany,
  restoreCompanyByTwentyId,
  updateCompany,
} from "@/modules/crm/company.service";
import { COMPANY_CHILD_TABLES } from "@/modules/crm/company.repository";
import { DuplicateRecordError } from "@/modules/crm/crm.shared";
import { createContact } from "@/modules/crm/contact.service";
import * as s from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { sql } from "drizzle-orm";
import {
  createCompany as createCompanyRow,
  createContact as createContactRow,
  createContract,
  createConversation,
  createDocument,
  createOpportunity as createOpportunityRow,
  createPortalClient,
  createProject,
  createQuote,
  createSite,
  createTicket,
} from "../../helpers/factories";
import { auditCount, createWorld, uuid, type World } from "./world";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => w.close());

describe("création d'un client", () => {
  it("écrit dans Twenty, puis la projection, et journalise", async () => {
    const company = await createCompany(w.member, {
      name: "Atelier Soleil",
      domain: "https://www.Atelier-Soleil.test/contact",
      status: "prospect",
      activity: "Fleuriste",
      phone: "06 12 34 56 78",
      tags: "vitrine, local",
      city: "Rouen",
    });
    expect(company.domain).toBe("atelier-soleil.test");
    expect(company.phone).toBe("+33612345678");
    expect(company.tags).toEqual(["vitrine", "local"]);
    expect(w.crm.companies.get(company.twentyId)?.name).toBe("Atelier Soleil");
    expect(w.crm.companies.get(company.twentyId)?.address.city).toBe("Rouen");
    expect(await auditCount(w.db, "company.created", company.id)).toBe(1);
  });

  it("se rejoue sans doublon avec le même identifiant", async () => {
    const id = uuid();
    const first = await createCompany(w.member, { id, name: "Rejeu SARL" });
    const second = await createCompany(w.member, { id, name: "Rejeu SARL" });
    expect(second.id).toBe(first.id);
    expect(await auditCount(w.db, "company.created", id)).toBe(1);
    expect([...w.crm.companies.values()].filter((row) => row.name === "Rejeu SARL")).toHaveLength(
      1,
    );
  });

  it("reprend une création déjà faite dans Twenty, projection absente (coupure entre les deux)", async () => {
    const id = uuid();
    await w.crm.createCompany({ id, name: "Coupure SAS" });
    const company = await createCompany(w.member, { id, name: "Coupure SAS" });
    expect(company.twentyId).toBe(id);
    expect([...w.crm.companies.values()].filter((row) => row.name === "Coupure SAS")).toHaveLength(
      1,
    );
  });

  it("refuse un téléphone non convertible en E.164", async () => {
    await expect(
      createCompany(w.member, { name: "Mauvais numéro", phone: "12" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("ne simule jamais un succès quand Twenty est coupé, et les lectures restent possibles", async () => {
    const before = await listCompanies(w.member, {});
    w.crm.simulateOutage();
    try {
      await expect(createCompany(w.member, { name: "Panne SA" })).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
      const during = await listCompanies(w.member, {});
      expect(during.total).toBe(before.total);
    } finally {
      w.crm.endOutage();
    }
  });

  it("refuse sans connexion au CRM", async () => {
    await expect(
      createCompany({ db: w.db, actor: w.member.actor }, { name: "Sans CRM" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});

describe("doublons", () => {
  it("un domaine connu localement propose la fiche, sans appel à Twenty", async () => {
    const existing = await createCompany(w.member, {
      name: "Domaine SARL",
      domain: "domaine.test",
    });
    const error = await createCompany(w.member, { name: "Autre", domain: "DOMAINE.test" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DuplicateRecordError);
    expect((error as DuplicateRecordError).duplicate).toMatchObject({
      entity: "company",
      field: "domain",
      id: existing.id,
      archived: false,
    });
  });

  it("une fiche archivée garde son domaine : on propose de la restaurer, pas de la recréer", async () => {
    const company = await createCompany(w.member, {
      name: "Archivée SARL",
      domain: "archivee.test",
    });
    await archiveCompany(w.member, company.id);
    const error = (await createCompany(w.member, {
      name: "Nouvelle",
      domain: "archivee.test",
    }).catch((caught: unknown) => caught)) as DuplicateRecordError;
    expect(error.duplicate.archived).toBe(true);
    const restored = await restoreCompany(w.member, company.id);
    expect(restored.archivedAt).toBeNull();
  });

  it("un domaine occupé dans Twenty seulement, fiche active : projetée puis proposée", async () => {
    const twenty = await w.crm.createCompany({
      id: uuid(),
      name: "Inconnue locale",
      domains: { primary: "inconnue.test", additional: [] },
    });
    const error = (await createCompany(w.member, {
      name: "Essai",
      domain: "inconnue.test",
    }).catch((caught: unknown) => caught)) as DuplicateRecordError;
    expect(error).toBeInstanceOf(DuplicateRecordError);
    expect(error.duplicate.twentyId).toBe(twenty.id);
    expect(error.duplicate.id).not.toBeNull();
  });

  it("un domaine occupé par une fiche archivée de Twenty, inconnue ici : restauration par son id", async () => {
    const twenty = await w.crm.createCompany({
      id: uuid(),
      name: "Fantôme",
      domains: { primary: "fantome.test", additional: [] },
    });
    await w.crm.deleteCompany(twenty.id);
    const error = (await createCompany(w.member, {
      name: "Essai 2",
      domain: "fantome.test",
    }).catch((caught: unknown) => caught)) as DuplicateRecordError;
    expect(error.duplicate).toMatchObject({ id: null, twentyId: twenty.id, archived: true });
    const restored = await restoreCompanyByTwentyId(w.member, twenty.id);
    expect(restored.name).toBe("Fantôme");
    expect(restored.archivedAt).toBeNull();
    expect(w.crm.companies.get(twenty.id)?.deletedAt).toBeNull();
  });

  it("un homonyme se confirme, le SIREN jamais", async () => {
    await createCompany(w.member, { name: "Boulangerie Dupré", siren: "123 456 789" });
    const error = (await createCompany(w.member, { name: "boulangerie dupre" }).catch(
      (caught: unknown) => caught,
    )) as DuplicateRecordError;
    expect(error.duplicate).toMatchObject({ field: "name", soft: true });
    const forced = await createCompany(w.member, {
      name: "boulangerie dupre",
      allowSameName: "on",
    });
    expect(forced.id).toBeDefined();
    await expect(
      createCompany(w.member, { name: "Autre société", siren: "123456789", allowSameName: "on" }),
    ).rejects.toBeInstanceOf(DuplicateRecordError);
  });

  it("détecte les groupes de doublons", async () => {
    await createCompanyRow(w.db, { name: "Doublon Nom" });
    await createCompanyRow(w.db, { name: "doublon-nom" });
    const groups = await listCompanyDuplicates(w.viewer);
    const group = groups.find((entry) => entry.key === "doublonnom");
    expect(group?.reason).toBe("name");
    expect(group?.members).toHaveLength(2);
  });
});

describe("modification", () => {
  it("n'appelle Twenty que pour les colonnes (T), et garde les domaines secondaires", async () => {
    const twenty = await w.crm.createCompany({
      id: uuid(),
      name: "Secondaires",
      domains: { primary: "principal.test", additional: ["secondaire.test"] },
    });
    const [local] = await w.db
      .insert(s.companies)
      .values({ twentyId: twenty.id, name: "Secondaires", domain: "principal.test" })
      .returning();
    if (!local) throw new Error("Insertion impossible");

    // Colonne de Nuera seule : disponible même si Twenty est coupé.
    w.crm.simulateOutage();
    const updated = await updateCompany(w.member, local.id, { activity: "Traiteur" });
    expect(updated.activity).toBe("Traiteur");
    await expect(updateCompany(w.member, local.id, { name: "Renommé" })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    w.crm.endOutage();

    const renamed = await updateCompany(w.member, local.id, {
      name: "Renommé",
      domain: "nouveau.test",
    });
    expect(renamed.name).toBe("Renommé");
    expect(renamed.domain).toBe("nouveau.test");
    expect(w.crm.companies.get(twenty.id)?.domains).toEqual({
      primary: "nouveau.test",
      additional: ["secondaire.test"],
    });
    expect(renamed.twentySyncedAt).not.toBeNull();
  });

  it("journalise le changement de statut", async () => {
    const company = await createCompany(w.member, { name: "Statut SARL" });
    await updateCompany(w.member, company.id, { status: "partner" });
    expect(await auditCount(w.db, "company.status_changed", company.id)).toBe(1);
  });

  it("une fiche du jeu d'essai accepte les colonnes de Nuera, refuse celles de Twenty", async () => {
    const seed = await createCompanyRow(w.db, { twentyId: `seed-${uuid()}`, name: "Jeu d'essai" });
    const updated = await updateCompany(w.member, seed.id, { notes: "Note locale" });
    expect(updated.notes).toBe("Note locale");
    await expect(updateCompany(w.member, seed.id, { name: "Autre" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(archiveCompany(w.member, seed.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("répond 404 pour une fiche inconnue", async () => {
    await expect(getCompany(w.member, uuid())).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCompany(w.member, uuid(), { notes: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("archivage", () => {
  it("archive dans Twenty et ici, sans toucher aux contacts ; rejouable", async () => {
    const company = await createCompany(w.member, { name: "À archiver" });
    const contact = await createContact(w.member, { companyId: company.id, lastName: "Reste" });
    const archived = await archiveCompany(w.member, company.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(w.crm.companies.get(company.twentyId)?.deletedAt).not.toBeNull();
    const [kept] = await w.db.select().from(s.contacts).where(eq(s.contacts.id, contact.id));
    expect(kept?.archivedAt).toBeNull();

    await archiveCompany(w.member, company.id);
    expect(await auditCount(w.db, "company.archived", company.id)).toBe(1);

    const listed = await listCompanies(w.member, { statut: "archived" });
    expect(listed.items.map((row) => row.company.id)).toContain(company.id);
    const active = await listCompanies(w.member, { q: "archiver" });
    expect(active.items.map((row) => row.company.id)).not.toContain(company.id);
  });
});

describe("fusion", () => {
  it("couvre toutes les tables qui portent company_id", async () => {
    const result = await w.db.execute(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'company_id'
    `);
    const tables = (result as unknown as { rows: { table_name: string }[] }).rows.map(
      (row) => row.table_name,
    );
    expect([...COMPANY_CHILD_TABLES].sort()).toEqual([...tables].sort());
  });

  it("déplace parents et enfants ensemble, garde la perdante archivée et libère son SIREN", async () => {
    const winner = await createCompany(w.admin, { name: "Gagnante", domain: "gagnante.test" });
    const loser = await createCompany(w.admin, {
      name: "Perdante",
      domain: "perdante.test",
      siren: "987654321",
      tags: "a,b",
      notes: "Note perdante",
      activity: "Menuiserie",
    });

    // Une dépendance par table à clé composite.
    const contact = await createContactRow(w.db, {
      companyId: loser.id,
      twentyId: `test-${uuid()}`,
      isPrimary: true,
    });
    const opportunity = await createOpportunityRow(w.db, {
      companyId: loser.id,
      contactId: contact.id,
    });
    const { quote } = await createQuote(w.db, {
      companyId: loser.id,
      opportunityId: opportunity.id,
    });
    const project = await createProject(w.db, {
      companyId: loser.id,
      opportunityId: opportunity.id,
      quoteId: quote.id,
    });
    const site = await createSite(w.db, { companyId: loser.id, projectId: project.id });
    const contract = await createContract(w.db, { companyId: loser.id, quoteId: quote.id });
    await w.db
      .insert(s.contractSites)
      .values({ contractId: contract.id, siteId: site.id, companyId: loser.id });
    await createTicket(w.db, {
      companyId: loser.id,
      siteId: site.id,
      projectId: project.id,
    });
    const { document } = await createDocument(w.db, { companyId: loser.id, projectId: project.id });
    const conversation = await createConversation(w.db, {
      companyId: loser.id,
      contactId: contact.id,
    });
    await w.db.insert(s.messages).values({
      companyId: loser.id,
      conversationId: conversation.id,
      direction: "inbound",
      body: "Bonjour",
      authorContactId: contact.id,
      documentId: document.id,
    });
    await w.db.insert(s.activities).values({
      kind: "call",
      subject: "Appel",
      companyId: loser.id,
      contactId: contact.id,
      opportunityId: opportunity.id,
    });
    await w.db.insert(s.domains).values({
      name: `perdante-${uuid()}.test`,
      companyId: loser.id,
      siteId: site.id,
    });
    await w.db
      .insert(s.financialDocuments)
      .values({ companyId: loser.id, source: "manual", amountCents: 100, projectId: project.id });
    await w.db.insert(s.appointments).values({
      title: "Rendez-vous",
      startsAt: new Date(),
      companyId: loser.id,
      contactId: contact.id,
      opportunityId: opportunity.id,
    });

    const merged = await mergeCompanies(w.admin, { winnerId: winner.id, loserId: loser.id });
    expect(merged.id).toBe(winner.id);
    expect(merged.siren).toBe("987654321");
    expect(merged.tags).toEqual(["a", "b"]);
    expect(merged.activity).toBe("Menuiserie");

    for (const table of COMPANY_CHILD_TABLES) {
      const result = await w.db.execute(
        sql`select count(*)::int as n from ${sql.raw(table)} where company_id = ${loser.id}::uuid`,
      );
      const n = (result as unknown as { rows: { n: number }[] }).rows[0]?.n;
      expect(n, `${table} encore sur la perdante`).toBe(0);
    }
    const [kept] = await w.db.select().from(s.companies).where(eq(s.companies.id, loser.id));
    expect(kept?.mergedIntoId).toBe(winner.id);
    expect(kept?.archivedAt).not.toBeNull();
    expect(w.crm.companies.has(loser.twentyId)).toBe(false);
    expect(await auditCount(w.db, "company.merged", winner.id)).toBe(1);

    // Le SIREN de la perdante est libre pour la gagnante seulement : une fiche absorbée ne compte plus.
    await expect(
      createCompany(w.admin, { name: "Autre", siren: "987654321" }),
    ).rejects.toBeInstanceOf(DuplicateRecordError);

    // Répéter la fusion ne change rien.
    const again = await mergeCompanies(w.admin, { winnerId: winner.id, loserId: loser.id });
    expect(again.id).toBe(winner.id);
    expect(await auditCount(w.db, "company.merged", winner.id)).toBe(1);
  });

  it("reprend la projection si Twenty a déjà fusionné (réponse perdue)", async () => {
    const winner = await createCompany(w.admin, { name: "Gagnante 2" });
    const loser = await createCompany(w.admin, { name: "Perdante 2" });
    await w.crm.mergeCompanies({ winnerId: winner.twentyId, loserIds: [loser.twentyId] });
    const merged = await mergeCompanies(w.admin, { winnerId: winner.id, loserId: loser.id });
    expect(merged.id).toBe(winner.id);
    const [kept] = await w.db.select().from(s.companies).where(eq(s.companies.id, loser.id));
    expect(kept?.mergedIntoId).toBe(winner.id);
  });

  it("garde le contact principal de la gagnante", async () => {
    const winner = await createCompany(w.admin, { name: "Gagnante 3" });
    const loser = await createCompany(w.admin, { name: "Perdante 3" });
    const a = await createContact(w.admin, {
      companyId: winner.id,
      lastName: "A",
      isPrimary: true,
    });
    const b = await createContact(w.admin, { companyId: loser.id, lastName: "B", isPrimary: true });
    await mergeCompanies(w.admin, { winnerId: winner.id, loserId: loser.id });
    const rows = await w.db.select().from(s.contacts).where(eq(s.contacts.companyId, winner.id));
    expect(rows.find((row) => row.id === a.id)?.isPrimary).toBe(true);
    expect(rows.find((row) => row.id === b.id)?.isPrimary).toBe(false);
  });

  it("déplace l'adhésion au portail avec le client", async () => {
    const winner = await createCompany(w.admin, { name: "Gagnante 4" });
    const loser = await createCompany(w.admin, { name: "Perdante 4" });
    const portal = await createPortalClient(w.db, { company: loser });
    await mergeCompanies(w.admin, { winnerId: winner.id, loserId: loser.id });
    const [membership] = await w.db
      .select()
      .from(s.portalMemberships)
      .where(eq(s.portalMemberships.id, portal.membership.id));
    expect(membership?.companyId).toBe(winner.id);
  });

  it("refuse le jeu d'essai, une fiche archivée, soi-même", async () => {
    const live = await createCompany(w.admin, { name: "Vivante" });
    const seed = await createCompanyRow(w.db, { twentyId: `seed-${uuid()}` });
    await expect(
      mergeCompanies(w.admin, { winnerId: live.id, loserId: seed.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    const archived = await createCompany(w.admin, { name: "Archivée 2" });
    await archiveCompany(w.admin, archived.id);
    await expect(
      mergeCompanies(w.admin, { winnerId: live.id, loserId: archived.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      mergeCompanies(w.admin, { winnerId: live.id, loserId: live.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("listes", () => {
  it("pagine, filtre, cherche, et résume sur le serveur", async () => {
    const page = await listCompanies(w.member, { pageSize: 2, page: 1 } as never);
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.total).toBeGreaterThan(2);

    const company = await createCompany(w.member, { name: "Zéphyr Conseil", source: "Réseau" });
    await createContact(w.member, {
      companyId: company.id,
      firstName: "Inès",
      lastName: "Morel",
      email: "ines.morel@zephyr.test",
      isPrimary: true,
    });
    const byContact = await listCompanies(w.member, { q: "morel" });
    expect(byContact.items.map((row) => row.company.id)).toContain(company.id);
    expect(byContact.items.find((row) => row.company.id === company.id)?.contactName).toBe(
      "Inès Morel",
    );

    const bySource = await listCompanies(w.member, { origine: "Réseau" });
    expect(bySource.items.every((row) => row.company.source === "Réseau")).toBe(true);

    const summary = await getCompanySummary(w.member);
    expect(summary.total).toBeGreaterThan(0);
  });
});

describe("permissions par rôle", () => {
  it("la lecture est réservée à l'équipe avec crm:read", async () => {
    await expect(listCompanies(w.viewer, {})).resolves.toBeDefined();
    await expect(listCompanies(w.contractor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCompany(w.contractor, uuid())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un lecteur n'écrit pas, un collaborateur ne fusionne pas", async () => {
    await expect(createCompany(w.viewer, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateCompany(w.viewer, uuid(), {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(archiveCompany(w.viewer, uuid())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      mergeCompanies(w.member, { winnerId: uuid(), loserId: uuid() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createCompany(w.contractor, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
