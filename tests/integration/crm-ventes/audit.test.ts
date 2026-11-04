import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeActivity,
  createActivity,
  listCompanyTimeline,
  updateActivity,
} from "@/modules/crm/activity.service";
import { loadCompanyRelated, loadSection } from "@/modules/crm/company.related";
import {
  archiveCompany,
  createCompany,
  mergeCompanies,
  restoreCompany,
  updateCompany,
} from "@/modules/crm/company.service";
import {
  archiveContact,
  createContact,
  mergeContacts,
  restoreContact,
  updateContact,
} from "@/modules/crm/contact.service";
import { previewCompanyImport, runCompanyImportBatch } from "@/modules/crm/crm.import.service";
import { syncCrmNow } from "@/modules/crm/crm.sync.service";
import { emitEvent } from "@/modules/platform/events";
import {
  archiveOpportunity,
  createOpportunity,
  getOpportunity,
  getOpportunityCommercialLinks,
  moveOpportunityStage,
  restoreOpportunity,
  setNextAction,
  updateOpportunity,
} from "@/modules/sales/opportunity.service";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { createProject, createQuote } from "../../helpers/factories";
import { createTestContext } from "../../helpers/db";
import { auditCount, createWorld, uuid, type World } from "./world";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => w.close());

const newCompany = (name = `Client ${uuid().slice(0, 8)}`) =>
  createCompany(w.member, { name, allowSameName: "on" });

/** Toute écriture vers Twenty déclencherait ce compteur. */
function countCrmWrites(): { calls: () => number; restore: () => void } {
  const crm = w.crm as unknown as Record<string, unknown>;
  const names = [
    "createNote",
    "createTask",
    "updateOpportunity",
    "updateCompany",
    "updatePerson",
    "createOpportunity",
  ];
  const originals = names.map((name) => crm[name]);
  let calls = 0;
  names.forEach((name, index) => {
    crm[name] = (...args: unknown[]) => {
      calls += 1;
      return (originals[index] as (...a: unknown[]) => unknown).apply(w.crm, args);
    };
  });
  return {
    calls: () => calls,
    restore: () => names.forEach((name, index) => (crm[name] = originals[index])),
  };
}

describe("liens d'une activité", () => {
  it("une affaire sans client ne se lie pas à un client : refus clair, rien dans Twenty", async () => {
    const company = await newCompany();
    const orphan = await createOpportunity(w.member, { name: "Sans client" });
    const writes = countCrmWrites();
    await expect(
      createActivity(w.member, {
        kind: "note",
        subject: "Note",
        companyId: company.id,
        opportunityId: orphan.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(writes.calls()).toBe(0);
    writes.restore();
  });

  it("un contact sans client ne se lie pas à un client : refus clair, rien dans Twenty", async () => {
    const company = await newCompany();
    const free = await createContact(w.member, { firstName: "Libre", lastName: uuid() });
    const writes = countCrmWrites();
    await expect(
      createActivity(w.member, {
        kind: "task",
        subject: "Tâche",
        companyId: company.id,
        contactId: free.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(writes.calls()).toBe(0);
    writes.restore();
  });

  it("le client d'une affaire ne se combine pas avec le contact d'un autre", async () => {
    const a = await newCompany();
    const b = await newCompany();
    const contact = await createContact(w.member, {
      firstName: "Autre",
      lastName: uuid(),
      companyId: a.id,
    });
    const opportunity = await createOpportunity(w.member, { name: "X", companyId: b.id });
    await expect(
      createActivity(w.member, {
        kind: "call",
        subject: "Appel",
        contactId: contact.id,
        opportunityId: opportunity.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse une fiche archivée ou absorbée : la consigner ne la fait pas revivre", async () => {
    const archived = await newCompany();
    await archiveCompany(w.member, archived.id);
    await expect(
      createActivity(w.member, { kind: "call", subject: "x", companyId: archived.id }),
    ).rejects.toBeInstanceOf(ConflictError);

    const winner = await newCompany();
    const loser = await newCompany();
    await mergeCompanies(w.admin, { winnerId: winner.id, loserId: loser.id });
    await expect(
      createActivity(w.member, { kind: "call", subject: "x", companyId: loser.id }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const company = await newCompany();
    const contact = await createContact(w.member, {
      firstName: "Ex",
      lastName: uuid(),
      companyId: company.id,
    });
    await archiveContact(w.member, contact.id);
    await expect(
      createActivity(w.member, { kind: "call", subject: "x", contactId: contact.id }),
    ).rejects.toBeInstanceOf(ConflictError);

    const opportunity = await createOpportunity(w.member, { name: "Y", companyId: company.id });
    await archiveOpportunity(w.member, opportunity.id);
    await expect(
      createActivity(w.member, { kind: "call", subject: "x", opportunityId: opportunity.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("fiches archivées : le service refuse, pas seulement l'interface", () => {
  it("une affaire archivée ne se modifie plus", async () => {
    const company = await newCompany();
    const opportunity = await createOpportunity(w.member, { name: "Z", companyId: company.id });
    await archiveOpportunity(w.member, opportunity.id);
    const writes = countCrmWrites();
    await expect(
      updateOpportunity(w.member, opportunity.id, { name: "Autre nom" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      setNextAction(w.member, opportunity.id, { nextAction: "Relancer" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(writes.calls()).toBe(0);
    writes.restore();
    await restoreOpportunity(w.member, opportunity.id);
    await expect(
      setNextAction(w.member, opportunity.id, { nextAction: "Relancer" }),
    ).resolves.toMatchObject({ nextAction: "Relancer" });
  });

  it("un client archivé ne se modifie plus, y compris ses colonnes locales", async () => {
    const company = await newCompany();
    await archiveCompany(w.member, company.id);
    await expect(updateCompany(w.member, company.id, { notes: "Note" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await restoreCompany(w.member, company.id);
    await expect(updateCompany(w.member, company.id, { notes: "Note" })).resolves.toMatchObject({
      notes: "Note",
    });
  });

  it("un contact archivé ne se modifie plus", async () => {
    const contact = await createContact(w.member, { firstName: "Arch", lastName: uuid() });
    await archiveContact(w.member, contact.id);
    await expect(updateContact(w.member, contact.id, { notes: "Note" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await restoreContact(w.member, contact.id);
    await expect(updateContact(w.member, contact.id, { notes: "Note" })).resolves.toMatchObject({
      notes: "Note",
    });
  });

  it("une nouvelle affaire ne se lie pas à un contact archivé", async () => {
    const company = await newCompany();
    const contact = await createContact(w.member, {
      firstName: "Parti",
      lastName: uuid(),
      companyId: company.id,
    });
    await archiveContact(w.member, contact.id);
    const writes = countCrmWrites();
    await expect(
      createOpportunity(w.member, { name: "A", companyId: company.id, contactId: contact.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(writes.calls()).toBe(0);
    writes.restore();
  });
});

describe("modification d'une affaire : ce que le formulaire n'envoie pas ne bouge pas", () => {
  it("un contact absent de l'envoi reste rattaché, ici et dans Twenty", async () => {
    const company = await newCompany();
    const contact = await createContact(w.member, {
      firstName: "Reste",
      lastName: uuid(),
      companyId: company.id,
    });
    const opportunity = await createOpportunity(w.member, {
      name: "Avec contact",
      companyId: company.id,
      contactId: contact.id,
    });
    const updated = await updateOpportunity(w.member, opportunity.id, {
      companyId: company.id,
      probability: "40",
    });
    expect(updated.contactId).toBe(contact.id);
    expect(updated.probability).toBe(40);
    const twenty = await w.crm.getOpportunity(opportunity.twentyId);
    expect(twenty.pointOfContactId).toBe(contact.twentyId);
  });
});

describe("concurrence sur une étape", () => {
  it("deux déplacements simultanés ne contournent pas la machine à états", async () => {
    const company = await newCompany();
    const opportunity = await createOpportunity(w.member, {
      name: "Course",
      companyId: company.id,
    });
    const results = await Promise.allSettled([
      moveOpportunityStage(w.member, {
        opportunityId: opportunity.id,
        toStage: "LOST",
        lostReason: "Budget",
      }),
      moveOpportunityStage(w.member, { opportunityId: opportunity.id, toStage: "QUALIFIED" }),
    ]);
    const history = await w.db
      .select()
      .from(s.opportunityStageHistory)
      .where(eq(s.opportunityStageHistory.opportunityId, opportunity.id));
    // Sans droit de réouverture, jamais de retour depuis une affaire close.
    expect(history.some((row) => row.fromStage === "LOST" || row.fromStage === "WON")).toBe(false);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const current = await getOpportunity(w.member, opportunity.id);
    const twenty = await w.crm.getOpportunity(opportunity.twentyId);
    expect(twenty.stage).toBe(current.stage);
  });
});

describe("devis et projets d'une affaire", () => {
  it("donne les devis et projets de cette affaire seulement, selon les droits", async () => {
    const company = await newCompany();
    const opportunity = await createOpportunity(w.member, { name: "Liens", companyId: company.id });
    const other = await createOpportunity(w.member, { name: "Autre", companyId: company.id });
    const { quote } = await createQuote(w.db, {
      companyId: company.id,
      opportunityId: opportunity.id,
    });
    await createQuote(w.db, { companyId: company.id, opportunityId: other.id });
    const project = await createProject(w.db, {
      companyId: company.id,
      opportunityId: opportunity.id,
      quoteId: quote.id,
    });

    const links = await getOpportunityCommercialLinks(w.member, opportunity.id);
    expect(links.quotes.map((row) => row.id)).toEqual([quote.id]);
    expect(links.projects.map((row) => row.id)).toEqual([project.id]);

    await expect(
      getOpportunityCommercialLinks(w.contractor, opportunity.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getOpportunityCommercialLinks(w.member, uuid())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("historique d'un client", () => {
  const firstPage = { page: 1, pageSize: 50 };

  it("reprend rendez-vous et événements ; une facture reste réservée à finance:read", async () => {
    const company = await newCompany();
    const other = await newCompany();
    const accepted = (companyId: string) =>
      emitEvent(w.db, {
        type: "quote.accepted",
        entityType: "quote",
        entityId: uuid(),
        companyId,
        payload: { number: "D-2026-001", versionId: uuid(), opportunityId: null, totalCents: 100 },
        actorId: null,
      });
    await accepted(company.id);
    await accepted(other.id);
    await emitEvent(w.db, {
      type: "invoice.paid",
      entityType: "financial_document",
      entityId: uuid(),
      companyId: company.id,
      payload: { externalRef: "INDY-1", amountCents: 100, paidOn: null },
      actorId: null,
    });
    // Déjà visible par la ligne d'étape : ne figure pas deux fois.
    await emitEvent(w.db, {
      type: "opportunity.created",
      entityType: "opportunity",
      entityId: uuid(),
      companyId: company.id,
      payload: { name: "x", stage: "NEW", amountCents: null },
      actorId: null,
    });
    await w.db.insert(s.appointments).values([
      {
        companyId: company.id,
        title: "Premier appel",
        startsAt: new Date(Date.now() - 86_400_000),
        durationMinutes: 30,
      },
      {
        companyId: company.id,
        title: "Rendez-vous à venir",
        startsAt: new Date(Date.now() + 86_400_000),
        durationMinutes: 30,
      },
      {
        companyId: company.id,
        title: "Annulé",
        startsAt: new Date(Date.now() - 86_400_000),
        durationMinutes: 30,
        status: "cancelled",
      },
    ]);

    const asAdmin = await listCompanyTimeline(w.admin, company.id, firstPage);
    expect(asAdmin.items.map((row) => [row.source, row.kind, row.body]).sort()).toEqual([
      ["appointment", "appointment", null],
      ["event", "invoice.paid", "INDY-1"],
      ["event", "quote.accepted", "D-2026-001"],
    ]);
    expect(asAdmin.total).toBe(3);

    const asViewer = await listCompanyTimeline(w.viewer, company.id, firstPage);
    expect(asViewer.items.map((row) => row.kind).sort()).toEqual(["appointment", "quote.accepted"]);
    expect(asViewer.total).toBe(2);
  });
});

describe("fiche 360°", () => {
  it("lit les sections du client, sans celles d'un autre, selon les droits", async () => {
    const company = await newCompany();
    const other = await newCompany();
    const { quote } = await createQuote(w.db, { companyId: company.id });
    await createQuote(w.db, { companyId: other.id });
    const blocked = await createProject(w.db, { companyId: company.id, status: "blocked" });
    await createProject(w.db, { companyId: company.id, status: "preparation" });
    await createProject(w.db, { companyId: other.id });

    const asAdmin = await loadCompanyRelated(w.admin, company.id);
    expect(asAdmin.quotes).toMatchObject({ state: "ready" });
    if (asAdmin.quotes.state === "ready") {
      expect(asAdmin.quotes.data.map((row) => row.id)).toEqual([quote.id]);
    }
    if (asAdmin.projects.state !== "ready") throw new Error("section projets indisponible");
    // Le projet en cours passe devant un projet plus récent encore en préparation.
    expect(asAdmin.projects.data.rows[0]?.id).toBe(blocked.id);
    expect(asAdmin.projects.data.rows).toHaveLength(2);
    expect(asAdmin.margin.state).toBe("ready");
    expect(asAdmin.invoices.state).toBe("ready");

    const asViewer = await loadCompanyRelated(w.viewer, company.id);
    expect(asViewer.margin).toEqual({ state: "absent" });
    expect(asViewer.invoices).toEqual({ state: "absent" });
    expect(asViewer.quotes.state).toBe("ready");

    await expect(loadCompanyRelated(w.contractor, company.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("une section en panne ne fait pas tomber la fiche", async () => {
    await expect(
      loadSection("essai", true, () => Promise.reject(new Error("panne"))),
    ).resolves.toEqual({ state: "unavailable" });
    let called = false;
    await expect(
      loadSection("essai", false, async () => {
        called = true;
      }),
    ).resolves.toEqual({ state: "absent" });
    expect(called).toBe(false);
  });
});

describe("droits, opération par opération", () => {
  const target = uuid();
  const writes: readonly [string, (ctx: ServiceContext) => Promise<unknown>][] = [
    ["createCompany", (ctx) => createCompany(ctx, { name: "x" })],
    ["updateCompany", (ctx) => updateCompany(ctx, target, { notes: "x" })],
    ["archiveCompany", (ctx) => archiveCompany(ctx, target)],
    ["restoreCompany", (ctx) => restoreCompany(ctx, target)],
    ["createContact", (ctx) => createContact(ctx, { firstName: "x" })],
    ["updateContact", (ctx) => updateContact(ctx, target, { notes: "x" })],
    ["archiveContact", (ctx) => archiveContact(ctx, target)],
    ["restoreContact", (ctx) => restoreContact(ctx, target)],
    [
      "createActivity",
      (ctx) => createActivity(ctx, { kind: "call", subject: "x", companyId: target }),
    ],
    ["updateActivity", (ctx) => updateActivity(ctx, target, { subject: "x" })],
    ["completeActivity", (ctx) => completeActivity(ctx, target)],
    ["previewCompanyImport", (ctx) => previewCompanyImport(ctx, { csv: "Nom\nx" })],
    [
      "runCompanyImportBatch",
      (ctx) => runCompanyImportBatch(ctx, { importId: target, csv: "Nom\nx", lines: [2] }),
    ],
    ["syncCrmNow", (ctx) => syncCrmNow(ctx)],
    ["createOpportunity", (ctx) => createOpportunity(ctx, { name: "x" })],
    ["updateOpportunity", (ctx) => updateOpportunity(ctx, target, { name: "x" })],
    ["setNextAction", (ctx) => setNextAction(ctx, target, { nextAction: "x" })],
    [
      "moveOpportunityStage",
      (ctx) => moveOpportunityStage(ctx, { opportunityId: target, toStage: "QUALIFIED" }),
    ],
    ["archiveOpportunity", (ctx) => archiveOpportunity(ctx, target)],
    ["restoreOpportunity", (ctx) => restoreOpportunity(ctx, target)],
  ];
  const merges: readonly [string, (ctx: ServiceContext) => Promise<unknown>][] = [
    ["mergeCompanies", (ctx) => mergeCompanies(ctx, { winnerId: target, loserId: uuid() })],
    ["mergeContacts", (ctx) => mergeContacts(ctx, { winnerId: target, loserId: uuid() })],
  ];

  it.each(["viewer", "contractor", "client"] as const)("%s n'écrit rien", async (role) => {
    const ctx =
      role === "viewer"
        ? w.viewer
        : role === "contractor"
          ? w.contractor
          : await createTestContext(w.db, "client", { crm: w.crm });
    for (const [name, write] of [...writes, ...merges]) {
      await expect(write(ctx), name).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("le collaborateur ne fusionne pas", async () => {
    for (const [name, merge] of merges) {
      await expect(merge(w.member), name).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("aucun refus ne laisse de trace d'audit", async () => {
    expect(await auditCount(w.db, "company.updated", target)).toBe(0);
    const rows = await w.db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, target)));
    expect(rows).toEqual([]);
  });
});
