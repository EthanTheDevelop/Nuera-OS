import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Actor } from "@/server/auth/permissions";
import type { Role } from "@/server/auth/roles";
import type { PortalContext, ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestActor } from "./db";

/**
 * Fabriques des objets centraux, partagées par tous les lots.
 *
 * Chacune insère une ligne valide, crée ce qui lui manque et accepte des surcharges. Les clés
 * composites s'appliquent : pour rattacher un objet à un parent, passer aussi le `companyId` du
 * parent, sinon la fabrique crée un nouveau client et l'insertion est refusée.
 */
let counter = 0;
const next = () => (counter += 1);

/** Une fabrique n'a jamais le droit de renvoyer rien. */
function one<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error("Insertion de test sans résultat");
  return row;
}

// --- CRM ---------------------------------------------------------------------------------------

export async function createCompany(
  db: Database,
  overrides: Partial<typeof schema.companies.$inferInsert> = {},
): Promise<schema.Company> {
  const n = next();
  return one(
    await db
      .insert(schema.companies)
      .values({ twentyId: `test-company-${randomUUID()}`, name: `Client ${n}`, ...overrides })
      .returning(),
  );
}

export async function createContact(
  db: Database,
  overrides: Partial<typeof schema.contacts.$inferInsert> = {},
): Promise<schema.Contact> {
  const n = next();
  // `companyId: null` est valide : Twenty accepte une personne sans organisation.
  const companyId =
    overrides.companyId === undefined ? (await createCompany(db)).id : overrides.companyId;
  return one(
    await db
      .insert(schema.contacts)
      .values({
        twentyId: `test-contact-${randomUUID()}`,
        firstName: "Prénom",
        lastName: `Contact ${n}`,
        email: `contact-${n}@test.local`,
        ...overrides,
        companyId,
      })
      .returning(),
  );
}

export async function createOpportunity(
  db: Database,
  overrides: Partial<typeof schema.opportunities.$inferInsert> = {},
): Promise<schema.Opportunity> {
  const n = next();
  // `companyId: null` est valide : une affaire peut naître sans client.
  const companyId =
    overrides.companyId === undefined ? (await createCompany(db)).id : overrides.companyId;
  return one(
    await db
      .insert(schema.opportunities)
      .values({
        twentyId: `test-opportunity-${randomUUID()}`,
        name: `Affaire ${n}`,
        ...overrides,
        companyId,
      })
      .returning(),
  );
}

// --- Offres ------------------------------------------------------------------------------------

/** Crée un devis et sa version courante. */
export async function createQuote(
  db: Database,
  overrides: Partial<typeof schema.quotes.$inferInsert> = {},
  versionOverrides: Partial<typeof schema.quoteVersions.$inferInsert> = {},
): Promise<{ quote: schema.Quote; version: schema.QuoteVersion }> {
  const n = next();
  const companyId = overrides.companyId ?? (await createCompany(db)).id;
  const quote = one(
    await db
      .insert(schema.quotes)
      .values({
        number: `TEST-D-${n}`,
        title: `Offre ${n}`,
        ...overrides,
        companyId,
      })
      .returning(),
  );
  const version = one(
    await db
      .insert(schema.quoteVersions)
      .values({ version: 1, totalCents: 100_000, ...versionOverrides, quoteId: quote.id })
      .returning(),
  );
  const updated = one(
    await db
      .update(schema.quotes)
      .set({ currentVersionId: version.id })
      .where(eq(schema.quotes.id, quote.id))
      .returning(),
  );
  return { quote: updated, version };
}

// --- Production --------------------------------------------------------------------------------

export async function createProject(
  db: Database,
  overrides: Partial<typeof schema.projects.$inferInsert> = {},
): Promise<schema.Project> {
  const n = next();
  const companyId = overrides.companyId ?? (await createCompany(db)).id;
  return one(
    await db
      .insert(schema.projects)
      .values({ number: `TEST-P-${n}`, name: `Projet ${n}`, ...overrides, companyId })
      .returning(),
  );
}

export async function createPhase(
  db: Database,
  overrides: Partial<typeof schema.projectPhases.$inferInsert> = {},
): Promise<schema.ProjectPhase> {
  const n = next();
  const projectId = overrides.projectId ?? (await createProject(db)).id;
  return one(
    await db
      .insert(schema.projectPhases)
      .values({ name: `Jalon ${n}`, position: n, ...overrides, projectId })
      .returning(),
  );
}

export async function createTask(
  db: Database,
  overrides: Partial<typeof schema.tasks.$inferInsert> = {},
): Promise<schema.Task> {
  const n = next();
  const projectId = overrides.projectId ?? (await createProject(db)).id;
  return one(
    await db
      .insert(schema.tasks)
      .values({ number: `TEST-TA-${n}`, title: `Tâche ${n}`, ...overrides, projectId })
      .returning(),
  );
}

// --- Temps et équipe ---------------------------------------------------------------------------

export async function createTeamMember(
  db: Database,
  overrides: Partial<typeof schema.teamMembers.$inferInsert> = {},
): Promise<schema.TeamMember> {
  const n = next();
  return one(
    await db
      .insert(schema.teamMembers)
      .values({
        kind: "employee",
        fullName: `Membre ${n}`,
        weeklyCapacityMinutes: 2100,
        hourlyCostCents: 4000,
        ...overrides,
      })
      .returning(),
  );
}

/** Contexte d'un compte d'équipe avec sa fiche : nécessaire aux périmètres `*_assigned`. */
export async function createMemberContext(
  db: Database,
  role: Exclude<Role, "client">,
  overrides: Partial<typeof schema.teamMembers.$inferInsert> = {},
): Promise<ServiceContext & { member: schema.TeamMember }> {
  const actor = await createTestActor(db, role);
  const member = await createTeamMember(db, {
    userId: actor.userId,
    kind: role === "admin" ? "partner" : role === "contractor" ? "contractor" : "employee",
    fullName: actor.name,
    email: actor.email,
    ...overrides,
  });
  return { db, actor, member };
}

// --- Sites, contrats, support, documents -------------------------------------------------------

export async function createSite(
  db: Database,
  overrides: Partial<typeof schema.sites.$inferInsert> = {},
): Promise<schema.Site> {
  const n = next();
  const companyId = overrides.companyId ?? (await createCompany(db)).id;
  return one(
    await db
      .insert(schema.sites)
      .values({
        name: `Site ${n}`,
        primaryDomain: `site-${n}.test.local`,
        ...overrides,
        companyId,
      })
      .returning(),
  );
}

export async function createContract(
  db: Database,
  overrides: Partial<typeof schema.contracts.$inferInsert> = {},
): Promise<schema.Contract> {
  const n = next();
  const companyId = overrides.companyId ?? (await createCompany(db)).id;
  return one(
    await db
      .insert(schema.contracts)
      .values({
        number: `TEST-C-${n}`,
        name: `Contrat ${n}`,
        kind: "maintenance",
        ...overrides,
        companyId,
      })
      .returning(),
  );
}

export async function createTicket(
  db: Database,
  overrides: Partial<typeof schema.tickets.$inferInsert> = {},
): Promise<schema.Ticket> {
  const n = next();
  const companyId = overrides.companyId ?? (await createCompany(db)).id;
  return one(
    await db
      .insert(schema.tickets)
      .values({
        number: `TEST-T-${n}`,
        subject: `Demande ${n}`,
        channel: "internal",
        category: "assistance",
        ...overrides,
        companyId,
      })
      .returning(),
  );
}

/** Crée un document et sa version courante, sans fichier réel. */
export async function createDocument(
  db: Database,
  overrides: Partial<typeof schema.documents.$inferInsert> = {},
): Promise<{ document: schema.Document; version: schema.DocumentVersion }> {
  const n = next();
  const document = one(
    await db
      .insert(schema.documents)
      .values({ title: `Document ${n}`, ...overrides })
      .returning(),
  );
  const version = one(
    await db
      .insert(schema.documentVersions)
      .values({
        documentId: document.id,
        version: 1,
        storageKey: `test/${randomUUID()}`,
        filename: `document-${n}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        sha256: "0".repeat(64),
      })
      .returning(),
  );
  const updated = one(
    await db
      .update(schema.documents)
      .set({ currentVersionId: version.id })
      .where(eq(schema.documents.id, document.id))
      .returning(),
  );
  return { document: updated, version };
}

export async function createConversation(
  db: Database,
  overrides: Partial<typeof schema.conversations.$inferInsert> = {},
): Promise<schema.Conversation> {
  const companyId = overrides.companyId ?? (await createCompany(db)).id;
  return one(
    await db
      .insert(schema.conversations)
      .values({ subject: "Conversation de test", ...overrides, companyId })
      .returning(),
  );
}

// --- Portail -----------------------------------------------------------------------------------

export interface PortalClient {
  actor: Actor;
  company: schema.Company;
  contact: schema.Contact;
  membership: schema.PortalMembership;
}

/** Compte `client` et son adhésion, active par défaut, sur une nouvelle entreprise si besoin. */
export async function createPortalClient(
  db: Database,
  options: {
    company?: schema.Company;
    contact?: schema.Contact;
    status?: schema.PortalMembershipStatus;
  } = {},
): Promise<PortalClient> {
  const company = options.company ?? (await createCompany(db, { status: "client" }));
  const contact = options.contact ?? (await createContact(db, { companyId: company.id }));
  const actor = await createTestActor(db, "client");
  const membership = one(
    await db
      .insert(schema.portalMemberships)
      .values({
        userId: actor.userId,
        companyId: company.id,
        contactId: contact.id,
        status: options.status ?? "active",
      })
      .returning(),
  );
  return { actor, company, contact, membership };
}

/**
 * `PortalContext` d'un client actif, plus ses objets. Pour éprouver le refus d'une adhésion
 * révoquée, passer par `createPortalClient` puis `resolvePortalContext`.
 */
export async function createPortalTestContext(
  db: Database,
  options: { company?: schema.Company; contact?: schema.Contact } = {},
): Promise<PortalContext & PortalClient> {
  const client = await createPortalClient(db, { ...options, status: "active" });
  return {
    ...client,
    db,
    companyId: client.company.id,
    contactId: client.contact.id,
  };
}
