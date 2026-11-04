import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TwentyWebhookRejectedError } from "@/integrations/twenty/twenty.webhook";
import { createCompany as createCompanyService } from "@/modules/crm/company.service";
import { createOpportunity } from "@/modules/sales/opportunity.service";
import {
  applyTwentyEvent,
  getCrmSyncStatus,
  handleTwentyWebhook,
  reconcileCrm,
  syncCrmNow,
} from "@/modules/crm/crm.sync.service";
import * as s from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, ServiceUnavailableError } from "@/server/errors";
import { createTestDatabase } from "../../helpers/db";
import {
  createCompany as createCompanyRow,
  createMemberContext,
  createPortalClient,
  createQuote,
} from "../../helpers/factories";
import { FakeCrmGateway } from "../../helpers/fake-crm-gateway";
import { auditCount, eventCount, uuid } from "./world";

let db: Database;
let close: () => Promise<void>;
let crm: FakeCrmGateway;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  // Chaque test raisonne sur une instance Twenty neuve ; la base locale se vide de son état de synchro.
  crm = new FakeCrmGateway();
  await db.delete(s.crmSyncState);
});

async function companyByTwentyId(twentyId: string) {
  const [row] = await db.select().from(s.companies).where(eq(s.companies.twentyId, twentyId));
  return row;
}
async function contactByTwentyId(twentyId: string) {
  const [row] = await db.select().from(s.contacts).where(eq(s.contacts.twentyId, twentyId));
  return row;
}
async function opportunityByTwentyId(twentyId: string) {
  const [row] = await db
    .select()
    .from(s.opportunities)
    .where(eq(s.opportunities.twentyId, twentyId));
  return row;
}
async function activityByTwentyId(twentyId: string) {
  const [row] = await db.select().from(s.activities).where(eq(s.activities.twentyId, twentyId));
  return row;
}

describe("réconciliation", () => {
  it("projette tous les objets, puis ne refait rien de plus", async () => {
    const company = await crm.createCompany({
      id: uuid(),
      name: "Réconcilié SARL",
      domains: { primary: "reconcilie.test", additional: [] },
      address: { city: "Lyon", postcode: "69001", street1: "1 rue", country: "France" },
    });
    const person = await crm.createPerson({
      id: uuid(),
      firstName: "Anne",
      lastName: "Dupont",
      emails: { primary: "anne@reconcilie.test", additional: [] },
      phones: { primary: "+33612345678", additional: [] },
      jobTitle: "Gérante",
      companyId: company.id,
    });
    const opportunity = await crm.createOpportunity({
      id: uuid(),
      name: "Refonte",
      stage: "QUALIFIED",
      amount: { cents: 500000, currency: "EUR" },
      closeDate: "2026-12-31",
      companyId: company.id,
      pointOfContactId: person.id,
    });
    const note = await crm.createNote({
      id: uuid(),
      title: "Besoin",
      bodyMarkdown: "Refonte complète",
      targets: [
        { type: "company", id: company.id },
        { type: "opportunity", id: opportunity.id },
      ],
    });
    const task = await crm.createTask({
      id: uuid(),
      title: "Rappeler",
      dueAt: "2026-11-20T12:00:00.000Z",
      targets: [{ type: "person", id: person.id }],
    });

    const result = await reconcileCrm({ db, crm });
    expect(result.objects.company.applied).toBe(1);
    expect(result.objects.person.applied).toBe(1);
    expect(result.objects.opportunity.applied).toBe(1);

    const localCompany = await companyByTwentyId(company.id);
    expect(localCompany).toMatchObject({
      name: "Réconcilié SARL",
      domain: "reconcilie.test",
      city: "Lyon",
      postalCode: "69001",
      addressLine: "1 rue",
      status: "prospect",
    });
    const localContact = await contactByTwentyId(person.id);
    expect(localContact).toMatchObject({
      companyId: localCompany?.id,
      firstName: "Anne",
      email: "anne@reconcilie.test",
      phone: "+33612345678",
    });
    const localOpportunity = await opportunityByTwentyId(opportunity.id);
    expect(localOpportunity).toMatchObject({
      stage: "QUALIFIED",
      amountCents: 500000,
      expectedCloseOn: "2026-12-31",
      companyId: localCompany?.id,
      contactId: localContact?.id,
    });
    const localNote = await activityByTwentyId(note.id);
    expect(localNote).toMatchObject({
      kind: "note",
      subject: "Besoin",
      companyId: localCompany?.id,
      opportunityId: localOpportunity?.id,
    });
    const localTask = await activityByTwentyId(task.id);
    expect(localTask).toMatchObject({ kind: "task", contactId: localContact?.id });
    expect(localTask?.dueAt?.toISOString()).toBe("2026-11-20T12:00:00.000Z");

    // Le curseur repart avec une marge : rejouer revoit les fiches sans rien casser.
    const history = await db
      .select()
      .from(s.opportunityStageHistory)
      .where(eq(s.opportunityStageHistory.opportunityId, localOpportunity!.id));
    expect(history).toHaveLength(1);
    await reconcileCrm({ db, crm });
    const again = await db
      .select()
      .from(s.opportunityStageHistory)
      .where(eq(s.opportunityStageHistory.opportunityId, localOpportunity!.id));
    expect(again).toHaveLength(1);
    expect(await eventCount(db, "opportunity.created", localOpportunity!.id)).toBe(1);
  });

  it("ne touche jamais aux colonnes de Nuera", async () => {
    const company = await crm.createCompany({ id: uuid(), name: "Avant" });
    await reconcileCrm({ db, crm });
    const local = await companyByTwentyId(company.id);
    await db
      .update(s.companies)
      .set({ status: "client", notes: "Note interne", tags: ["a"], activity: "Fleuriste" })
      .where(eq(s.companies.id, local!.id));
    await crm.updateCompany(company.id, { name: "Après" });
    await reconcileCrm({ db, crm });
    expect(await companyByTwentyId(company.id)).toMatchObject({
      name: "Après",
      status: "client",
      notes: "Note interne",
      tags: ["a"],
      activity: "Fleuriste",
    });
  });

  it("une étape changée dans Twenty est enregistrée sans machine à états, avec ses effets", async () => {
    const company = await crm.createCompany({ id: uuid(), name: "Étapes" });
    const opportunity = await crm.createOpportunity({
      id: uuid(),
      name: "Saut",
      companyId: company.id,
      amount: { cents: 1000, currency: "EUR" },
    });
    await reconcileCrm({ db, crm });
    await crm.updateOpportunity(opportunity.id, { stage: "WON" });
    await reconcileCrm({ db, crm });

    const local = await opportunityByTwentyId(opportunity.id);
    expect(local?.stage).toBe("WON");
    expect(local?.wonAt).not.toBeNull();
    expect(await eventCount(db, "opportunity.won", local!.id)).toBe(1);
    expect((await companyByTwentyId(company.id))?.status).toBe("client");

    await reconcileCrm({ db, crm });
    expect(await eventCount(db, "opportunity.won", local!.id)).toBe(1);
  });

  it("archive ce que Twenty archive, restaure ce qu'il restaure", async () => {
    const company = await crm.createCompany({ id: uuid(), name: "Va et vient" });
    const person = await crm.createPerson({ id: uuid(), firstName: "A", lastName: "B" });
    const opportunity = await crm.createOpportunity({ id: uuid(), name: "Va et vient" });
    await reconcileCrm({ db, crm });

    await crm.deleteCompany(company.id);
    await crm.deletePerson(person.id);
    await crm.deleteOpportunity(opportunity.id);
    await reconcileCrm({ db, crm });
    expect((await companyByTwentyId(company.id))?.archivedAt).not.toBeNull();
    expect((await contactByTwentyId(person.id))?.archivedAt).not.toBeNull();
    expect((await opportunityByTwentyId(opportunity.id))?.archivedAt).not.toBeNull();

    await crm.restoreCompany(company.id);
    await reconcileCrm({ db, crm });
    expect((await companyByTwentyId(company.id))?.archivedAt).toBeNull();
  });

  it("une note archivée quitte la projection, sa tâche aussi", async () => {
    const company = await crm.createCompany({ id: uuid(), name: "Notes" });
    const note = await crm.createNote({
      id: uuid(),
      title: "N",
      targets: [{ type: "company", id: company.id }],
    });
    await reconcileCrm({ db, crm });
    expect(await activityByTwentyId(note.id)).toBeDefined();
    await crm.deleteNote(note.id);
    await reconcileCrm({ db, crm });
    expect(await activityByTwentyId(note.id)).toBeUndefined();
  });

  it("détecte une suppression définitive à la comparaison complète", async () => {
    const stay = await crm.createCompany({ id: uuid(), name: "Reste" });
    const gone = await crm.createCompany({ id: uuid(), name: "Purgée" });
    await reconcileCrm({ db, crm });
    crm.companies.delete(gone.id);

    // Passe ordinaire : la purge est invisible.
    await reconcileCrm({ db, crm });
    expect((await companyByTwentyId(gone.id))?.archivedAt).toBeNull();

    // Comparaison demandée (le bouton, ou la tâche quotidienne).
    await reconcileCrm({ db, crm }, { full: true });
    expect((await companyByTwentyId(gone.id))?.archivedAt).not.toBeNull();
    expect((await companyByTwentyId(stay.id))?.archivedAt).toBeNull();
  });

  it("déclenche seule la comparaison quand la dernière a plus de 24 h", async () => {
    const gone = await crm.createCompany({ id: uuid(), name: "Purgée 24 h" });
    const now = new Date();
    await reconcileCrm({ db, crm }, { now });
    crm.companies.delete(gone.id);
    await reconcileCrm({ db, crm }, { now: new Date(now.getTime() + 60 * 60 * 1000) });
    expect((await companyByTwentyId(gone.id))?.archivedAt).toBeNull();
    await reconcileCrm({ db, crm }, { now: new Date(now.getTime() + 25 * 60 * 60 * 1000) });
    expect((await companyByTwentyId(gone.id))?.archivedAt).not.toBeNull();
  });

  it("ignore les lignes du jeu d'essai", async () => {
    const seed = await createCompanyRow(db, { twentyId: `seed-${uuid()}`, name: "Semence" });
    await reconcileCrm({ db, crm }, { full: true });
    const [row] = await db.select().from(s.companies).where(eq(s.companies.id, seed.id));
    expect(row?.archivedAt).toBeNull();
  });

  it("n'archive rien si trop de fiches manquent d'un coup (mauvaise instance)", async () => {
    const twentyIds = Array.from({ length: 15 }, () => uuid());
    for (const id of twentyIds) await crm.createCompany({ id, name: `Masse ${id}` });
    await reconcileCrm({ db, crm });
    crm.companies.clear();
    const result = await reconcileCrm({ db, crm }, { full: true });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect((await companyByTwentyId(twentyIds[0]!))?.archivedAt).toBeNull();
    // Remise en ordre pour les tests suivants : fiches archivées, hors des comparaisons.
    for (const id of twentyIds) {
      await db
        .update(s.companies)
        .set({ archivedAt: new Date() })
        .where(eq(s.companies.twentyId, id));
    }
  });

  it("vide et journalise un contact d'un autre client (accepté par Twenty, pas par nous)", async () => {
    const a = await crm.createCompany({ id: uuid(), name: "Client A" });
    const b = await crm.createCompany({ id: uuid(), name: "Client B" });
    const person = await crm.createPerson({
      id: uuid(),
      firstName: "Chez",
      lastName: "B",
      companyId: b.id,
    });
    const opportunity = await crm.createOpportunity({
      id: uuid(),
      name: "Croisée",
      companyId: a.id,
      pointOfContactId: person.id,
    });
    const result = await reconcileCrm({ db, crm });
    expect(result.crossCompanyContacts).toBe(1);
    const local = await opportunityByTwentyId(opportunity.id);
    expect(local?.contactId).toBeNull();
    expect(local?.companyId).toBe((await companyByTwentyId(a.id))?.id);
  });

  it("une affaire sans client, un client qui arrive ensuite", async () => {
    const opportunity = await crm.createOpportunity({ id: uuid(), name: "Sans client" });
    await reconcileCrm({ db, crm });
    expect((await opportunityByTwentyId(opportunity.id))?.companyId).toBeNull();
    const company = await crm.createCompany({ id: uuid(), name: "Arrivé" });
    await crm.updateOpportunity(opportunity.id, { companyId: company.id });
    await reconcileCrm({ db, crm });
    expect((await opportunityByTwentyId(opportunity.id))?.companyId).toBe(
      (await companyByTwentyId(company.id))?.id,
    );
  });

  it("un contact déplacé vide ses liens de l'ancien client, sans violer les clés composites", async () => {
    const a = await crm.createCompany({ id: uuid(), name: "Ancien" });
    const b = await crm.createCompany({ id: uuid(), name: "Nouveau" });
    const person = await crm.createPerson({
      id: uuid(),
      firstName: "Mobile",
      lastName: "M",
      companyId: a.id,
    });
    const opportunity = await crm.createOpportunity({
      id: uuid(),
      name: "Chez A",
      companyId: a.id,
      pointOfContactId: person.id,
    });
    await reconcileCrm({ db, crm });
    await crm.updatePerson(person.id, { companyId: b.id });
    await reconcileCrm({ db, crm });
    expect((await contactByTwentyId(person.id))?.companyId).toBe(
      (await companyByTwentyId(b.id))?.id,
    );
    expect((await opportunityByTwentyId(opportunity.id))?.contactId).toBeNull();
  });

  it("refuse de déplacer un contact qui a un accès au portail", async () => {
    const a = await crm.createCompany({ id: uuid(), name: "Portail A" });
    const b = await crm.createCompany({ id: uuid(), name: "Portail B" });
    const person = await crm.createPerson({
      id: uuid(),
      firstName: "Portail",
      lastName: "P",
      companyId: a.id,
    });
    await reconcileCrm({ db, crm });
    const contact = await contactByTwentyId(person.id);
    const company = await companyByTwentyId(a.id);
    await createPortalClient(db, { company: company!, contact: contact! });
    await crm.updatePerson(person.id, { companyId: b.id, jobTitle: "Directrice" });
    await reconcileCrm({ db, crm });
    const after = await contactByTwentyId(person.id);
    expect(after?.companyId).toBe(company?.id);
    expect(after?.jobTitle).toBe("Directrice");
  });

  it("refuse de déplacer une affaire qui a un devis", async () => {
    const a = await crm.createCompany({ id: uuid(), name: "Devis A" });
    const b = await crm.createCompany({ id: uuid(), name: "Devis B" });
    const opportunity = await crm.createOpportunity({
      id: uuid(),
      name: "Avec devis",
      companyId: a.id,
    });
    await reconcileCrm({ db, crm });
    const local = await opportunityByTwentyId(opportunity.id);
    const company = await companyByTwentyId(a.id);
    await createQuote(db, { companyId: company!.id, opportunityId: local!.id });
    await crm.updateOpportunity(opportunity.id, { companyId: b.id });
    await reconcileCrm({ db, crm });
    expect((await opportunityByTwentyId(opportunity.id))?.companyId).toBe(company?.id);
  });

  it("un lien d'activité ajouté dans Twenty, sans changer updatedAt, est rattrapé", async () => {
    const company = await crm.createCompany({ id: uuid(), name: "Liens" });
    const person = await crm.createPerson({
      id: uuid(),
      firstName: "Lié",
      lastName: "L",
      companyId: company.id,
    });
    const note = await crm.createNote({
      id: uuid(),
      title: "N",
      targets: [{ type: "company", id: company.id }],
    });
    await reconcileCrm({ db, crm });
    expect((await activityByTwentyId(note.id))?.contactId).toBeNull();
    await crm.updateNote(note.id, {
      targets: [
        { type: "company", id: company.id },
        { type: "person", id: person.id },
      ],
    });
    await reconcileCrm({ db, crm });
    expect((await activityByTwentyId(note.id))?.contactId).toBe(
      (await contactByTwentyId(person.id))?.id,
    );
  });

  it("garde le travail fait et l'erreur si Twenty tombe, repart au curseur", async () => {
    await crm.createCompany({ id: uuid(), name: "Premier" });
    crm.simulateOutage("unreachable");
    await expect(reconcileCrm({ db, crm })).rejects.toBeInstanceOf(ServiceUnavailableError);
    const [state] = await db
      .select()
      .from(s.crmSyncState)
      .where(eq(s.crmSyncState.object, "company"));
    expect(state?.lastError).toBeTruthy();
    const runs = await db.select().from(s.syncRuns);
    expect(runs.some((run) => run.status === "failed")).toBe(true);

    crm.endOutage();
    const result = await reconcileCrm({ db, crm });
    expect(result.objects.company.applied).toBeGreaterThan(0);
    const [after] = await db
      .select()
      .from(s.crmSyncState)
      .where(eq(s.crmSyncState.object, "company"));
    expect(after?.lastError).toBeNull();
  });

  it("une panne de configuration lève ServiceUnavailableError sans rien écrire", async () => {
    const before = (await db.select().from(s.syncRuns)).length;
    await expect(
      reconcileCrm({ db, crm: { isConfigured: false } as unknown as FakeCrmGateway }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect((await db.select().from(s.syncRuns)).length).toBe(before);
  });

  it("le bouton exige crm:update, journalise l'acteur, et le statut porte sa date", async () => {
    const member = await createMemberContext(db, "member");
    const viewer = await createMemberContext(db, "viewer");
    await expect(syncCrmNow({ ...viewer, crm })).rejects.toBeInstanceOf(ForbiddenError);
    const result = await syncCrmNow({ ...member, crm });
    expect(await auditCount(db, "crm.sync_ran", result.runId)).toBe(1);
    const status = await getCrmSyncStatus({ ...viewer, crm });
    expect(status.configured).toBe(true);
    expect(status.lastSuccessAt).toBeInstanceOf(Date);
    expect(status.canSync).toBe(false);
    expect((await getCrmSyncStatus({ ...member, crm })).canSync).toBe(true);
    const contractor = await createMemberContext(db, "contractor");
    await expect(getCrmSyncStatus({ ...contractor, crm })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("webhook", () => {
  const SECRET = "x".repeat(64);

  function delivery(
    payload: unknown,
    options: { secret?: string; nowMs?: number; nonce?: string } = {},
  ) {
    const rawBody = JSON.stringify(payload);
    const timestamp = String(options.nowMs ?? Date.now());
    const signature = createHmac("sha256", options.secret ?? SECRET)
      .update(`${timestamp}:${rawBody}`)
      .digest("hex");
    return {
      rawBody,
      headers: {
        "x-twenty-webhook-signature": signature,
        "x-twenty-webhook-timestamp": timestamp,
        "x-twenty-webhook-nonce": options.nonce ?? randomBytes(16).toString("hex"),
      },
      secret: SECRET,
    };
  }

  function companyPayload(id: string, action: string, overrides: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    return {
      eventName: `company.${action}`,
      objectMetadata: { id: uuid(), nameSingular: "company" },
      workspaceId: uuid(),
      webhookId: uuid(),
      eventDate: now,
      targetUrl: "https://example.test/hook",
      updatedFields: [],
      record: {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        name: "Reçue par webhook",
        domainName: { primaryLinkUrl: "webhook.test", primaryLinkLabel: "", secondaryLinks: [] },
        linkedinLink: { primaryLinkUrl: "", primaryLinkLabel: "", secondaryLinks: [] },
        address: { addressCity: "Nantes" },
        ...overrides,
      },
    };
  }

  it("refuse une signature fausse ou absente, sans rien écrire", async () => {
    const id = uuid();
    const payload = companyPayload(id, "created");
    await expect(
      handleTwentyWebhook({ db, crm }, delivery(payload, { secret: "y".repeat(64) })),
    ).rejects.toBeInstanceOf(TwentyWebhookRejectedError);
    await expect(
      handleTwentyWebhook(
        { db, crm },
        { rawBody: JSON.stringify(payload), headers: {}, secret: SECRET },
      ),
    ).rejects.toBeInstanceOf(TwentyWebhookRejectedError);
    await expect(
      handleTwentyWebhook({ db, crm }, delivery(payload, { nowMs: Date.now() - 10 * 60 * 1000 })),
    ).rejects.toBeInstanceOf(TwentyWebhookRejectedError);
    expect(await companyByTwentyId(id)).toBeUndefined();
  });

  it("met à jour la projection, et une relivraison est ignorée", async () => {
    const id = uuid();
    const nonce = randomBytes(16).toString("hex");
    const first = delivery(companyPayload(id, "created"), { nonce });
    expect(await handleTwentyWebhook({ db, crm }, first)).toBe("processed");
    expect((await companyByTwentyId(id))?.name).toBe("Reçue par webhook");

    await db
      .update(s.companies)
      .set({ name: "Modifié entre-temps" })
      .where(eq(s.companies.twentyId, id));
    expect(await handleTwentyWebhook({ db, crm }, first)).toBe("duplicate");
    expect((await companyByTwentyId(id))?.name).toBe("Modifié entre-temps");

    const [receipt] = await db
      .select()
      .from(s.webhookReceipts)
      .where(eq(s.webhookReceipts.externalId, nonce));
    expect(receipt?.status).toBe("processed");
  });

  it("ignore une version plus ancienne que celle déjà connue", async () => {
    const id = uuid();
    const now = Date.now();
    await handleTwentyWebhook(
      { db, crm },
      delivery(
        companyPayload(id, "updated", {
          name: "Récent",
          updatedAt: new Date(now).toISOString(),
        }),
      ),
    );
    await handleTwentyWebhook(
      { db, crm },
      delivery(
        companyPayload(id, "updated", {
          name: "Ancien",
          updatedAt: new Date(now - 60_000).toISOString(),
        }),
      ),
    );
    expect((await companyByTwentyId(id))?.name).toBe("Récent");
  });

  it("archive sur deleted et destroyed, restaure sur restored", async () => {
    const id = uuid();
    await handleTwentyWebhook({ db, crm }, delivery(companyPayload(id, "created")));
    await handleTwentyWebhook(
      { db, crm },
      delivery(
        companyPayload(id, "deleted", {
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          deletedAt: new Date(Date.now() + 1000).toISOString(),
        }),
      ),
    );
    expect((await companyByTwentyId(id))?.archivedAt).not.toBeNull();
    await handleTwentyWebhook(
      { db, crm },
      delivery(
        companyPayload(id, "restored", { updatedAt: new Date(Date.now() + 2000).toISOString() }),
      ),
    );
    expect((await companyByTwentyId(id))?.archivedAt).toBeNull();
    await handleTwentyWebhook(
      { db, crm },
      delivery(
        companyPayload(id, "destroyed", { updatedAt: new Date(Date.now() + 3000).toISOString() }),
      ),
    );
    expect((await companyByTwentyId(id))?.archivedAt).not.toBeNull();
  });

  it("note ignore un objet sans projection et un corps illisible", async () => {
    const other = delivery({
      eventName: "workflow.created",
      objectMetadata: { id: uuid(), nameSingular: "workflow" },
      workspaceId: uuid(),
      webhookId: uuid(),
      eventDate: new Date().toISOString(),
      targetUrl: "https://example.test/hook",
      record: { id: uuid() },
    });
    expect(await handleTwentyWebhook({ db, crm }, other)).toBe("ignored");
  });

  it("marque le reçu en échec si la projection échoue, sans simuler de succès", async () => {
    const nonce = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const link = delivery(
      {
        eventName: "noteTarget.created",
        objectMetadata: { id: uuid(), nameSingular: "noteTarget" },
        workspaceId: uuid(),
        webhookId: uuid(),
        eventDate: now,
        targetUrl: "https://example.test/hook",
        record: {
          id: uuid(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          noteId: uuid(),
          targetCompanyId: uuid(),
        },
      },
      { nonce },
    );
    crm.simulateOutage();
    try {
      expect(await handleTwentyWebhook({ db, crm }, link)).toBe("failed");
    } finally {
      crm.endOutage();
    }
    const [receipt] = await db
      .select()
      .from(s.webhookReceipts)
      .where(eq(s.webhookReceipts.externalId, nonce));
    expect(receipt?.status).toBe("failed");
  });

  it("applique les événements de personne, d'affaire et de note", async () => {
    const company = await crm.createCompany({ id: uuid(), name: "Web" });
    await reconcileCrm({ db, crm });
    const person = await crm.createPerson({
      id: uuid(),
      firstName: "Web",
      lastName: "Hook",
      companyId: company.id,
    });
    const base = {
      action: "created" as const,
      eventName: "x",
      occurredAt: new Date().toISOString(),
      updatedFields: [],
      webhookId: "w",
      workspaceId: "w",
    };
    await applyTwentyEvent(
      { db, crm },
      { ...base, entity: "person", recordId: person.id, record: person },
    );
    expect((await contactByTwentyId(person.id))?.companyId).toBe(
      (await companyByTwentyId(company.id))?.id,
    );

    const opportunity = await crm.createOpportunity({
      id: uuid(),
      name: "Web",
      companyId: company.id,
    });
    await applyTwentyEvent(
      { db, crm },
      { ...base, entity: "opportunity", recordId: opportunity.id, record: opportunity },
    );
    expect(await opportunityByTwentyId(opportunity.id)).toBeDefined();

    const note = await crm.createNote({
      id: uuid(),
      title: "Web",
      targets: [{ type: "company", id: company.id }],
    });
    const { targets, ...noteRecord } = note;
    await applyTwentyEvent(
      { db, crm },
      { ...base, entity: "note", recordId: note.id, record: noteRecord },
    );
    // La note seule n'a pas ses liens : l'événement du lien les rattrape, par une lecture.
    expect((await activityByTwentyId(note.id))?.companyId).toBeNull();
    await applyTwentyEvent(
      { db, crm },
      {
        ...base,
        entity: "activityLink",
        recordId: uuid(),
        record: {
          id: uuid(),
          createdAt: base.occurredAt,
          updatedAt: base.occurredAt,
          deletedAt: null,
          activityType: "note",
          activityId: note.id,
          target: targets[0] ?? null,
        },
      },
    );
    expect((await activityByTwentyId(note.id))?.companyId).toBe(
      (await companyByTwentyId(company.id))?.id,
    );
  });

  it("l'écho d'une écriture de Nuera ne rejoue ni audit ni historique", async () => {
    const member = await createMemberContext(db, "member");
    const ctx = { ...member, crm };
    const company = await createCompanyService(ctx, { name: `Écho ${uuid()}` });
    const opportunity = await createOpportunity(ctx, { name: "Écho", companyId: company.id });
    const record = crm.opportunities.get(opportunity.twentyId);
    await applyTwentyEvent(
      { db, crm },
      {
        action: "updated",
        eventName: "opportunity.updated",
        recordId: opportunity.twentyId,
        occurredAt: new Date().toISOString(),
        updatedFields: [],
        webhookId: "w",
        workspaceId: "w",
        entity: "opportunity",
        record: record!,
      },
    );
    const history = await db
      .select()
      .from(s.opportunityStageHistory)
      .where(eq(s.opportunityStageHistory.opportunityId, opportunity.id));
    expect(history).toHaveLength(1);
    expect(await auditCount(db, "opportunity.created", opportunity.id)).toBe(1);
  });
});
