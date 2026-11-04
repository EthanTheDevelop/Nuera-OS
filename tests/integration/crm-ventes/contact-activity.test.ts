import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeActivity,
  createActivity,
  listActivitiesForCompany,
  listCompanyTimeline,
  listOpenTasksForCompany,
  updateActivity,
} from "@/modules/crm/activity.service";
import { createCompany } from "@/modules/crm/company.service";
import {
  archiveContact,
  createContact,
  listContactDirectory,
  listContactDuplicates,
  listContactsForCompany,
  mergeContacts,
  restoreContact,
  updateContact,
} from "@/modules/crm/contact.service";
import { DuplicateRecordError } from "@/modules/crm/crm.shared";
import { createOpportunity, moveOpportunityStage } from "@/modules/sales/opportunity.service";
import * as s from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { createPortalClient, createContact as createContactRow } from "../../helpers/factories";
import { auditCount, createWorld, uuid, type World } from "./world";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => w.close());

describe("contacts", () => {
  it("crée dans Twenty, avec rôles et téléphone E.164 ; un seul contact principal", async () => {
    const company = await createCompany(w.member, { name: "Contacts SARL" });
    const first = await createContact(w.member, {
      companyId: company.id,
      firstName: "Claire",
      lastName: "Martin",
      email: "CLAIRE@contacts.test",
      phone: "0612345678",
      jobTitle: "Gérante",
      roles: ["decision", "signatory"],
      isPrimary: "on",
    });
    expect(first.email).toBe("claire@contacts.test");
    expect(first.phone).toBe("+33612345678");
    expect(first.roles).toEqual(["decision", "signatory"]);
    expect(w.crm.people.get(first.twentyId)?.companyId).toBe(company.twentyId);

    const second = await createContact(w.member, {
      companyId: company.id,
      lastName: "Bernard",
      isPrimary: "on",
    });
    const rows = await listContactsForCompany(w.viewer, company.id);
    expect(rows[0]?.id).toBe(second.id);
    expect(rows.filter((row) => row.isPrimary)).toHaveLength(1);
  });

  it("exige un nom, refuse un rôle inconnu, un téléphone invalide", async () => {
    await expect(createContact(w.member, { email: "a@b.test" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createContact(w.member, { lastName: "X", roles: ["chef"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createContact(w.member, { lastName: "X", phone: "abc" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("se rejoue sans doublon", async () => {
    const id = uuid();
    await createContact(w.member, { id, lastName: "Rejeu" });
    await createContact(w.member, { id, lastName: "Rejeu" });
    expect(await auditCount(w.db, "contact.created", id)).toBe(1);
  });

  it("un e-mail pris propose la fiche, archivée comprise, et se restaure", async () => {
    const contact = await createContact(w.member, { lastName: "Pris", email: "pris@test.test" });
    await archiveContact(w.member, contact.id);
    const error = (await createContact(w.member, {
      lastName: "Neuf",
      email: "pris@test.test",
    }).catch((caught: unknown) => caught)) as DuplicateRecordError;
    expect(error).toBeInstanceOf(DuplicateRecordError);
    expect(error.duplicate).toMatchObject({ entity: "contact", id: contact.id, archived: true });
    const restored = await restoreContact(w.member, contact.id);
    expect(restored.archivedAt).toBeNull();
    expect(w.crm.people.get(contact.twentyId)?.deletedAt).toBeNull();
  });

  it("un e-mail connu de Twenty seul remonte en doublon, jamais en recréation", async () => {
    const twenty = await w.crm.createPerson({
      id: uuid(),
      firstName: "Ailleurs",
      lastName: "Seul",
      emails: { primary: "ailleurs@test.test", additional: [] },
    });
    const error = (await createContact(w.member, {
      lastName: "Essai",
      email: "ailleurs@test.test",
    }).catch((caught: unknown) => caught)) as DuplicateRecordError;
    expect(error.duplicate).toMatchObject({ id: null, twentyId: twenty.id, archived: false });
  });

  it("change e-mail et téléphone en gardant les valeurs secondaires de Twenty", async () => {
    const twenty = await w.crm.createPerson({
      id: uuid(),
      firstName: "Multi",
      lastName: "Valeurs",
      emails: { primary: "un@test.test", additional: ["deux@test.test"] },
      phones: { primary: "+33612345678", additional: ["+33698765432"] },
    });
    const local = await createContactRow(w.db, {
      twentyId: twenty.id,
      companyId: null,
      firstName: "Multi",
      lastName: "Valeurs",
      email: "un@test.test",
      phone: "+33612345678",
    });
    const updated = await updateContact(w.member, local.id, {
      email: "trois@test.test",
      phone: "0711223344",
    });
    expect(updated.email).toBe("trois@test.test");
    expect(w.crm.people.get(twenty.id)?.emails.additional).toEqual(["deux@test.test"]);
    expect(w.crm.people.get(twenty.id)?.phones).toEqual({
      primary: "+33711223344",
      additional: ["+33698765432"],
    });
  });

  it("colonnes de Nuera disponibles même Twenty coupé, colonnes (T) refusées", async () => {
    const contact = await createContact(w.member, { lastName: "Coupé" });
    w.crm.simulateOutage();
    try {
      const updated = await updateContact(w.member, contact.id, { roles: ["billing"] });
      expect(updated.roles).toEqual(["billing"]);
      await expect(
        updateContact(w.member, contact.id, { jobTitle: "Comptable" }),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    } finally {
      w.crm.endOutage();
    }
  });

  it("déplacer un contact vide les liens de l'ancien client dans la même instruction", async () => {
    const a = await createCompany(w.member, { name: "Déplacement A" });
    const b = await createCompany(w.member, { name: "Déplacement B" });
    const contact = await createContact(w.member, { companyId: a.id, lastName: "Mobile" });
    const opportunity = await createOpportunity(w.member, {
      name: "Affaire A",
      companyId: a.id,
      contactId: contact.id,
    });
    const moved = await updateContact(w.member, contact.id, { companyId: b.id });
    expect(moved.companyId).toBe(b.id);
    const [row] = await w.db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, opportunity.id));
    expect(row?.contactId).toBeNull();
    expect(row?.companyId).toBe(a.id);
  });

  it("refuse de déplacer un contact qui a un accès au portail", async () => {
    const portal = await createPortalClient(w.db);
    const other = await createCompany(w.member, { name: "Autre client" });
    await expect(
      updateContact(w.member, portal.contact.id, { companyId: other.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("fusionne deux contacts d'un même client : liens et rôles suivent, audit", async () => {
    const company = await createCompany(w.admin, { name: "Fusion contacts" });
    const winner = await createContact(w.admin, {
      companyId: company.id,
      lastName: "Gagnant",
      roles: ["decision"],
      email: "gagnant@fusion.test",
    });
    const loser = await createContact(w.admin, {
      companyId: company.id,
      lastName: "Perdant",
      roles: ["billing"],
      email: "perdant@fusion.test",
    });
    const opportunity = await createOpportunity(w.admin, {
      name: "Affaire fusion",
      companyId: company.id,
      contactId: loser.id,
    });
    const merged = await mergeContacts(w.admin, { winnerId: winner.id, loserId: loser.id });
    expect(merged.roles).toEqual(["decision", "billing"]);
    expect(w.crm.people.has(loser.twentyId)).toBe(false);
    const [row] = await w.db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, opportunity.id));
    expect(row?.contactId).toBe(winner.id);
    expect(await auditCount(w.db, "contact.merged", winner.id)).toBe(1);
  });

  it("refuse la fusion de contacts de deux clients différents", async () => {
    const a = await createCompany(w.admin, { name: "Client X" });
    const b = await createCompany(w.admin, { name: "Client Y" });
    const one = await createContact(w.admin, { companyId: a.id, lastName: "Un" });
    const two = await createContact(w.admin, { companyId: b.id, lastName: "Deux" });
    await expect(
      mergeContacts(w.admin, { winnerId: one.id, loserId: two.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse la fusion si les deux ont un accès au portail", async () => {
    const company = await createCompany(w.admin, { name: "Deux portails" });
    const one = await createContactRow(w.db, { companyId: company.id, twentyId: uuid() });
    const two = await createContactRow(w.db, { companyId: company.id, twentyId: uuid() });
    await createPortalClient(w.db, { company, contact: one });
    await createPortalClient(w.db, { company, contact: two });
    await expect(
      mergeContacts(w.admin, { winnerId: one.id, loserId: two.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("annuaire paginé et recherche ; doublons détectés", async () => {
    const company = await createCompany(w.member, { name: "Annuaire SAS" });
    await createContact(w.member, {
      companyId: company.id,
      firstName: "Sophie",
      lastName: "Annuaire",
      roles: ["technical"],
    });
    const found = await listContactDirectory(w.viewer, { q: "annuaire" });
    expect(found.items.map((row) => row.lastName)).toContain("Annuaire");
    const byRole = await listContactDirectory(w.viewer, { role: "technical" });
    expect(byRole.items.every((row) => row.roles.includes("technical"))).toBe(true);

    await createContactRow(w.db, { companyId: null, email: "double@test.test" });
    await createContactRow(w.db, { companyId: null, email: "DOUBLE@test.test" });
    const groups = await listContactDuplicates(w.viewer);
    const group = groups.find((entry) => entry.key === "double@test.test");
    expect(group?.members).toHaveLength(2);
  });

  it("permissions : lecture sans écriture pour un lecteur, rien pour un prestataire", async () => {
    await expect(listContactDirectory(w.viewer, {})).resolves.toBeDefined();
    await expect(createContact(w.viewer, { lastName: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listContactDirectory(w.contractor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      mergeContacts(w.member, { winnerId: uuid(), loserId: uuid() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("activités", () => {
  it("une note va dans Twenty avec ses cibles, un appel reste local même Twenty coupé", async () => {
    const company = await createCompany(w.member, { name: "Activités SARL" });
    const contact = await createContact(w.member, { companyId: company.id, lastName: "Parle" });
    const note = await createActivity(w.member, {
      kind: "note",
      subject: "Objection sur le prix",
      body: "Préfère étaler le paiement.",
      companyId: company.id,
      contactId: contact.id,
    });
    expect(note.twentyId).toBe(note.id);
    const twentyNote = await w.crm.getNote(note.twentyId!);
    expect(twentyNote.targets).toHaveLength(2);

    w.crm.simulateOutage();
    try {
      const call = await createActivity(w.member, {
        kind: "call",
        subject: "Appel de découverte",
        companyId: company.id,
      });
      expect(call.twentyId).toBeNull();
      await expect(
        createActivity(w.member, { kind: "note", subject: "x", companyId: company.id }),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    } finally {
      w.crm.endOutage();
    }
    const list = await listActivitiesForCompany(w.viewer, company.id);
    expect(list.map((row) => row.kind).sort()).toEqual(["call", "note"]);
  });

  it("une tâche porte sa date et son responsable ; terminer est idempotent", async () => {
    const company = await createCompany(w.member, { name: "Tâches SARL" });
    const task = await createActivity(w.member, {
      kind: "task",
      subject: "Relancer",
      companyId: company.id,
      dueOn: "2026-12-01",
      ownerMemberId: (w.member as World["member"] & { member: { id: string } }).member.id,
    });
    expect(task.dueAt?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect((await w.crm.getTask(task.twentyId!)).dueAt).toBe(task.dueAt?.toISOString());

    const open = await listOpenTasksForCompany(w.viewer, company.id);
    expect(open.map((row) => row.id)).toContain(task.id);
    expect(open[0]?.ownerName).toBeTruthy();

    const done = await completeActivity(w.member, task.id);
    expect(done.completedAt).not.toBeNull();
    expect((await w.crm.getTask(task.twentyId!)).status).toBe("DONE");
    await completeActivity(w.member, task.id);
    expect(await auditCount(w.db, "activity.completed", task.id)).toBe(1);
    expect(await listOpenTasksForCompany(w.viewer, company.id)).toHaveLength(0);
  });

  it("se rejoue sans doublon", async () => {
    const company = await createCompany(w.member, { name: "Rejeu activité" });
    const id = uuid();
    await createActivity(w.member, { id, kind: "note", subject: "N", companyId: company.id });
    await createActivity(w.member, { id, kind: "note", subject: "N", companyId: company.id });
    expect(await auditCount(w.db, "activity.created", id)).toBe(1);
  });

  it("refuse un contact ou une affaire d'un autre client, et une activité sans lien", async () => {
    const a = await createCompany(w.member, { name: "Cloison A" });
    const b = await createCompany(w.member, { name: "Cloison B" });
    const contact = await createContact(w.member, { companyId: b.id, lastName: "B" });
    const opportunity = await createOpportunity(w.member, { name: "Affaire B", companyId: b.id });
    await expect(
      createActivity(w.member, {
        kind: "call",
        subject: "x",
        companyId: a.id,
        contactId: contact.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createActivity(w.member, {
        kind: "call",
        subject: "x",
        companyId: a.id,
        opportunityId: opportunity.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(createActivity(w.member, { kind: "call", subject: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createActivity(w.member, { kind: "call", subject: "x", companyId: uuid() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("le client se déduit de l'affaire ou du contact", async () => {
    const company = await createCompany(w.member, { name: "Déduit SARL" });
    const opportunity = await createOpportunity(w.member, {
      name: "Affaire déduite",
      companyId: company.id,
    });
    const call = await createActivity(w.member, {
      kind: "call",
      subject: "Appel",
      opportunityId: opportunity.id,
    });
    expect(call.companyId).toBe(company.id);
    const [row] = await w.db
      .select()
      .from(s.opportunities)
      .where(eq(s.opportunities.id, opportunity.id));
    expect(row?.lastActivityAt?.getTime()).toBeGreaterThanOrEqual(call.occurredAt.getTime() - 1000);
  });

  it("modifie une note dans Twenty ; un appel reste local", async () => {
    const company = await createCompany(w.member, { name: "Modif activité" });
    const note = await createActivity(w.member, {
      kind: "note",
      subject: "Avant",
      companyId: company.id,
    });
    await updateActivity(w.member, note.id, { subject: "Après", body: "Corps" });
    expect((await w.crm.getNote(note.twentyId!)).title).toBe("Après");
    const call = await createActivity(w.member, {
      kind: "call",
      subject: "Appel",
      companyId: company.id,
    });
    w.crm.simulateOutage();
    try {
      const updated = await updateActivity(w.member, call.id, { subject: "Appel corrigé" });
      expect(updated.subject).toBe("Appel corrigé");
    } finally {
      w.crm.endOutage();
    }
    await expect(completeActivity(w.member, call.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("chronologie : échanges et changements d'étape, paginés, du plus récent au plus ancien", async () => {
    const company = await createCompany(w.member, { name: "Chronologie SAS" });
    const opportunity = await createOpportunity(w.member, {
      name: "Affaire chrono",
      companyId: company.id,
    });
    await createActivity(w.member, {
      kind: "meeting",
      subject: "Réunion",
      companyId: company.id,
      opportunityId: opportunity.id,
    });
    await moveOpportunityStage(w.member, { opportunityId: opportunity.id, toStage: "QUALIFIED" });
    const page = await listCompanyTimeline(w.viewer, company.id, { page: 1, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.source).toBe("stage");
    expect(page.items[0]?.toStage).toBe("QUALIFIED");
  });

  it("permissions", async () => {
    await expect(
      createActivity(w.viewer, { kind: "call", subject: "x", companyId: uuid() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listActivitiesForCompany(w.contractor, uuid())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
