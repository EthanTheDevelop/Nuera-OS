import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { OpportunityStage, QuoteStatus } from "@/lib/domain-enums";
import {
  auditLog,
  catalogItems,
  changeRequests,
  companies,
  contacts,
  opportunities,
  paymentScheduleItems,
  projects,
  quoteLines,
  quotes,
  quoteVersions,
  users,
  webhookReceipts,
  type Quote,
  type QuoteLine,
  type QuoteVersion,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export type NewQuote = typeof quotes.$inferInsert;
export type NewQuoteVersion = typeof quoteVersions.$inferInsert;
export type NewQuoteLine = typeof quoteLines.$inferInsert;

/** Un identifiant mal formé ne peut désigner aucun devis : 404, pas une erreur SQL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// --- Liste -------------------------------------------------------------------------------------

export interface QuoteListRow {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  sentAt: Date | null;
  acceptedAt: Date | null;
  companyId: string;
  companyName: string;
  totalCents: number;
  parentQuoteId: string | null;
}

const LIST_COLUMNS = {
  id: quotes.id,
  number: quotes.number,
  title: quotes.title,
  status: quotes.status,
  sentAt: quotes.sentAt,
  acceptedAt: quotes.acceptedAt,
  companyId: quotes.companyId,
  companyName: companies.name,
  totalCents: sql<number>`coalesce(${quoteVersions.totalCents}, 0)`.mapWith(Number),
  parentQuoteId: quotes.parentQuoteId,
};

export interface QuoteListQuery {
  search?: string;
  statuses?: readonly QuoteStatus[];
}

function listWhere(query: QuoteListQuery): SQL | undefined {
  const search = query.search ? `%${escapeLike(query.search)}%` : null;
  return and(
    isNull(quotes.archivedAt),
    query.statuses ? inArray(quotes.status, [...query.statuses]) : undefined,
    search
      ? or(ilike(quotes.number, search), ilike(quotes.title, search), ilike(companies.name, search))
      : undefined,
  );
}

export async function findPage(
  db: Database,
  query: QuoteListQuery,
  paging: { page: number; pageSize: number },
): Promise<{ items: QuoteListRow[]; total: number }> {
  const where = listWhere(query);
  const [items, totals] = await Promise.all([
    db
      .select(LIST_COLUMNS)
      .from(quotes)
      .innerJoin(companies, eq(companies.id, quotes.companyId))
      .leftJoin(quoteVersions, eq(quoteVersions.id, quotes.currentVersionId))
      .where(where)
      .orderBy(desc(quotes.number), desc(quotes.id))
      .limit(paging.pageSize)
      .offset((paging.page - 1) * paging.pageSize),
    db
      .select({ total: count() })
      .from(quotes)
      .innerJoin(companies, eq(companies.id, quotes.companyId))
      .where(where),
  ]);
  return { items, total: totals[0]?.total ?? 0 };
}

export async function findByCompany(
  db: Database,
  companyId: string,
  limit: number,
): Promise<QuoteListRow[]> {
  if (!UUID.test(companyId)) return [];
  return db
    .select(LIST_COLUMNS)
    .from(quotes)
    .innerJoin(companies, eq(companies.id, quotes.companyId))
    .leftJoin(quoteVersions, eq(quoteVersions.id, quotes.currentVersionId))
    .where(and(eq(quotes.companyId, companyId), isNull(quotes.archivedAt)))
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .limit(limit);
}

export interface QuoteSummary {
  toSignCount: number;
  toSignCents: number;
  signedThisMonthCount: number;
  signedThisMonthCents: number;
}

/** Résumé de l'en-tête : calculé en SQL, indépendamment de la page affichée. */
export async function summarize(db: Database, monthStart: Date): Promise<QuoteSummary> {
  const toSign = sql`${quotes.status} in ('sent', 'negotiation')`;
  const signedThisMonth = sql`${quotes.status} = 'accepted' and ${quotes.acceptedAt} >= ${monthStart.toISOString()}::timestamptz`;
  const [row] = await db
    .select({
      toSignCount: sql<number>`count(*) filter (where ${toSign})`.mapWith(Number),
      toSignCents:
        sql<number>`coalesce(sum(${quoteVersions.totalCents}) filter (where ${toSign}), 0)`.mapWith(
          Number,
        ),
      signedThisMonthCount: sql<number>`count(*) filter (where ${signedThisMonth})`.mapWith(Number),
      signedThisMonthCents:
        sql<number>`coalesce(sum(${quoteVersions.totalCents}) filter (where ${signedThisMonth}), 0)`.mapWith(
          Number,
        ),
    })
    .from(quotes)
    .leftJoin(quoteVersions, eq(quoteVersions.id, quotes.currentVersionId))
    .where(isNull(quotes.archivedAt));
  return (
    row ?? { toSignCount: 0, toSignCents: 0, signedThisMonthCount: 0, signedThisMonthCents: 0 }
  );
}

// --- Devis -------------------------------------------------------------------------------------

export async function findById(db: Database, id: string): Promise<Quote | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, id), isNull(quotes.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Y compris archivé : rend l'archivage idempotent. */
export async function lockAnyById(tx: Database, id: string): Promise<Quote | null> {
  if (!UUID.test(id)) return null;
  const [row] = await tx.select().from(quotes).where(eq(quotes.id, id)).for("update").limit(1);
  return row ?? null;
}

/** Verrouille le devis jusqu'à la fin de la transaction : deux décisions s'attendent. */
export async function lockById(tx: Database, id: string): Promise<Quote | null> {
  if (!UUID.test(id)) return null;
  const [row] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, id), isNull(quotes.archivedAt)))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function lockBySubmissionId(
  tx: Database,
  submissionId: string,
): Promise<Quote | null> {
  const [row] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.docusealSubmissionId, submissionId), isNull(quotes.archivedAt)))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function insertQuote(tx: Database, values: NewQuote): Promise<Quote> {
  const [row] = await tx.insert(quotes).values(values).returning();
  if (!row) throw new Error("Devis non créé.");
  return row;
}

export async function updateQuote(
  tx: Database,
  id: string,
  values: Partial<NewQuote>,
): Promise<Quote> {
  const [row] = await tx
    .update(quotes)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(quotes.id, id))
    .returning();
  if (!row) throw new Error("Devis non modifié.");
  return row;
}

export interface QuoteContextRow {
  companyName: string;
  companyAddress: {
    addressLine: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  };
  opportunityName: string | null;
  opportunityContactId: string | null;
}

export async function findContext(
  db: Database,
  quote: Pick<Quote, "companyId" | "opportunityId">,
): Promise<QuoteContextRow> {
  const [company] = await db
    .select({
      name: companies.name,
      addressLine: companies.addressLine,
      postalCode: companies.postalCode,
      city: companies.city,
      country: companies.country,
    })
    .from(companies)
    .where(eq(companies.id, quote.companyId))
    .limit(1);
  const [opportunity] = quote.opportunityId
    ? await db
        .select({ name: opportunities.name, contactId: opportunities.contactId })
        .from(opportunities)
        .where(eq(opportunities.id, quote.opportunityId))
        .limit(1)
    : [];
  return {
    companyName: company?.name ?? "",
    companyAddress: {
      addressLine: company?.addressLine ?? null,
      postalCode: company?.postalCode ?? null,
      city: company?.city ?? null,
      country: company?.country ?? null,
    },
    opportunityName: opportunity?.name ?? null,
    opportunityContactId: opportunity?.contactId ?? null,
  };
}

/** L'affaire de ce client, si elle en est une. Évite un refus SQL brut de la clé composite. */
export async function findCompanyOpportunity(
  db: Database,
  opportunityId: string,
  companyId: string,
): Promise<{ stage: OpportunityStage; archivedAt: Date | null } | null> {
  const [row] = await db
    .select({ stage: opportunities.stage, archivedAt: opportunities.archivedAt })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

/** Devis d'origine déjà accepté sur cette affaire, autre que celui-ci : une affaire, un projet. */
export async function findAcceptedSibling(
  db: Database,
  opportunityId: string,
  quoteId: string,
): Promise<{ id: string; number: string } | null> {
  const [row] = await db
    .select({ id: quotes.id, number: quotes.number })
    .from(quotes)
    .where(
      and(
        eq(quotes.opportunityId, opportunityId),
        ne(quotes.id, quoteId),
        isNull(quotes.parentQuoteId),
        eq(quotes.status, "accepted"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Sérialise deux acceptations concurrentes de devis différents sur la même affaire. */
export async function lockOpportunity(tx: Database, opportunityId: string): Promise<void> {
  await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .for("update");
}

/** Une demande de changement désigne-t-elle ce devis ? Elle y renvoie, il doit rester ouvrable. */
export async function isLinkedToChangeRequest(db: Database, quoteId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: changeRequests.id })
    .from(changeRequests)
    .where(eq(changeRequests.quoteId, quoteId))
    .limit(1);
  return Boolean(row);
}

export async function companyExists(db: Database, companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.archivedAt)))
    .limit(1);
  return Boolean(row);
}

export async function findContact(
  db: Database,
  contactId: string,
  companyId: string,
): Promise<{ id: string; fullName: string; email: string | null } | null> {
  const [row] = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.companyId, companyId),
        isNull(contacts.archivedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    fullName: [row.firstName, row.lastName].filter(Boolean).join(" "),
    email: row.email,
  };
}

// --- Versions et lignes ------------------------------------------------------------------------

export async function findVersion(
  db: Database,
  quoteId: string,
  versionId: string,
): Promise<QuoteVersion | null> {
  const [row] = await db
    .select()
    .from(quoteVersions)
    .where(and(eq(quoteVersions.id, versionId), eq(quoteVersions.quoteId, quoteId)))
    .limit(1);
  return row ?? null;
}

export async function findVersions(db: Database, quoteId: string): Promise<QuoteVersion[]> {
  return db
    .select()
    .from(quoteVersions)
    .where(eq(quoteVersions.quoteId, quoteId))
    .orderBy(desc(quoteVersions.version));
}

/** Dernière version réellement envoyée : c'est elle que le client signe. */
export async function findLatestSentVersion(
  db: Database,
  quoteId: string,
): Promise<QuoteVersion | null> {
  const [row] = await db
    .select()
    .from(quoteVersions)
    .where(and(eq(quoteVersions.quoteId, quoteId), isNotNull(quoteVersions.sentAt)))
    .orderBy(desc(quoteVersions.version))
    .limit(1);
  return row ?? null;
}

export async function nextVersionNumber(tx: Database, quoteId: string): Promise<number> {
  const [row] = await tx
    .select({ last: sql<number>`coalesce(max(${quoteVersions.version}), 0)`.mapWith(Number) })
    .from(quoteVersions)
    .where(eq(quoteVersions.quoteId, quoteId));
  return (row?.last ?? 0) + 1;
}

export async function insertVersion(tx: Database, values: NewQuoteVersion): Promise<QuoteVersion> {
  const [row] = await tx.insert(quoteVersions).values(values).returning();
  if (!row) throw new Error("Version non créée.");
  return row;
}

export async function updateVersion(
  tx: Database,
  id: string,
  values: Partial<NewQuoteVersion>,
): Promise<QuoteVersion> {
  const [row] = await tx
    .update(quoteVersions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(quoteVersions.id, id))
    .returning();
  if (!row) throw new Error("Version non modifiée.");
  return row;
}

export type QuoteLineRow = QuoteLine & { recurring: boolean };

export async function findLines(db: Database, versionId: string): Promise<QuoteLineRow[]> {
  const rows = await db
    .select({ line: quoteLines, kind: catalogItems.kind })
    .from(quoteLines)
    .leftJoin(catalogItems, eq(catalogItems.id, quoteLines.catalogItemId))
    .where(eq(quoteLines.quoteVersionId, versionId))
    .orderBy(asc(quoteLines.position), asc(quoteLines.createdAt));
  return rows.map(({ line, kind }) => ({ ...line, recurring: kind === "recurring" }));
}

/** Remplace les lignes d'une version non envoyée. Une version envoyée n'arrive jamais ici. */
export async function replaceLines(
  tx: Database,
  versionId: string,
  lines: Omit<NewQuoteLine, "quoteVersionId">[],
): Promise<void> {
  await tx.delete(quoteLines).where(eq(quoteLines.quoteVersionId, versionId));
  if (lines.length === 0) return;
  await tx.insert(quoteLines).values(lines.map((line) => ({ ...line, quoteVersionId: versionId })));
}

// --- Avenants ----------------------------------------------------------------------------------

export interface QuoteLink {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
}

const LINK_COLUMNS = {
  id: quotes.id,
  number: quotes.number,
  title: quotes.title,
  status: quotes.status,
};

export async function findLink(db: Database, id: string): Promise<QuoteLink | null> {
  const [row] = await db.select(LINK_COLUMNS).from(quotes).where(eq(quotes.id, id)).limit(1);
  return row ?? null;
}

export async function findAmendments(db: Database, parentId: string): Promise<QuoteLink[]> {
  return db
    .select(LINK_COLUMNS)
    .from(quotes)
    .where(and(eq(quotes.parentQuoteId, parentId), isNull(quotes.archivedAt)))
    .orderBy(asc(quotes.number));
}

// --- Suites d'un devis accepté ------------------------------------------------------------------

/** Projet né de ce devis (un seul, index unique partiel). Lecture de lien, sans donnée métier. */
export async function findProjectLink(
  db: Database,
  quoteId: string,
): Promise<{ id: string; number: string } | null> {
  const [row] = await db
    .select({ id: projects.id, number: projects.number })
    .from(projects)
    .where(and(eq(projects.quoteId, quoteId), isNull(projects.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Au moins une échéance de ce devis est-elle payée ? Condition de démarrage « acompte ». */
export async function hasPaidScheduleItem(db: Database, quoteId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: paymentScheduleItems.id })
    .from(paymentScheduleItems)
    .where(
      and(
        eq(paymentScheduleItems.quoteId, quoteId),
        eq(paymentScheduleItems.status, "paid"),
        isNull(paymentScheduleItems.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// --- Rappels et expiration ---------------------------------------------------------------------

export interface QuoteReminderRow {
  id: string;
  number: string;
  title: string;
  companyId: string;
  companyName: string;
  opportunityId: string | null;
  docusealSubmissionId: string | null;
  sentAt: Date;
  lastReminderAt: Date | null;
  totalCents: number;
}

export async function findDueForReminder(
  db: Database,
  threshold: Date,
): Promise<QuoteReminderRow[]> {
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      companyId: quotes.companyId,
      companyName: companies.name,
      opportunityId: quotes.opportunityId,
      docusealSubmissionId: quotes.docusealSubmissionId,
      sentAt: quotes.sentAt,
      lastReminderAt: quotes.lastReminderAt,
      totalCents: sql<number>`coalesce(${quoteVersions.totalCents}, 0)`.mapWith(Number),
    })
    .from(quotes)
    .innerJoin(companies, eq(companies.id, quotes.companyId))
    .leftJoin(quoteVersions, eq(quoteVersions.id, quotes.currentVersionId))
    .where(
      and(
        isNull(quotes.archivedAt),
        eq(quotes.status, "sent"),
        inArray(quotes.signatureStatus, ["none", "pending", "unavailable"]),
        lte(quotes.sentAt, threshold),
        or(isNull(quotes.lastReminderAt), lte(quotes.lastReminderAt, threshold)),
      ),
    )
    .orderBy(asc(quotes.sentAt));
  return rows.flatMap((row) => (row.sentAt ? [{ ...row, sentAt: row.sentAt }] : []));
}

/** Devis envoyés dont la validité de la dernière version envoyée est dépassée. */
export async function findExpirableIds(db: Database, today: string): Promise<string[]> {
  const rows = await db
    .select({ id: quotes.id })
    .from(quotes)
    .innerJoin(
      quoteVersions,
      and(eq(quoteVersions.quoteId, quotes.id), isNotNull(quoteVersions.sentAt)),
    )
    .where(
      and(
        isNull(quotes.archivedAt),
        eq(quotes.status, "sent"),
        lt(quoteVersions.validUntil, today),
        sql`${quoteVersions.version} = (
          select max(v.version) from ${quoteVersions} v
          where v.quote_id = ${quotes.id} and v.sent_at is not null
        )`,
      ),
    );
  return rows.map((row) => row.id);
}

// --- Réceptions de webhooks --------------------------------------------------------------------

/** Vrai à la première réception, faux pour un rejeu. À appeler dans la transaction du traitement. */
export async function claimWebhookReceipt(tx: Database, externalId: string): Promise<boolean> {
  const rows = await tx
    .insert(webhookReceipts)
    .values({ service: "docuseal", externalId, status: "received" })
    .onConflictDoNothing({ target: [webhookReceipts.service, webhookReceipts.externalId] })
    .returning({ id: webhookReceipts.id });
  return rows.length > 0;
}

export async function setWebhookReceiptStatus(
  tx: Database,
  externalId: string,
  status: "processed" | "ignored",
): Promise<void> {
  await tx
    .update(webhookReceipts)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(webhookReceipts.service, "docuseal"), eq(webhookReceipts.externalId, externalId)),
    );
}

// --- Historique et comptes ---------------------------------------------------------------------

export interface QuoteHistoryRow {
  id: string;
  action: string;
  occurredAt: Date;
  actorName: string | null;
  metadata: Record<string, unknown>;
}

export async function findHistory(
  db: Database,
  quoteId: string,
  limit: number,
): Promise<QuoteHistoryRow[]> {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      occurredAt: auditLog.occurredAt,
      actorName: users.name,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(and(eq(auditLog.entityType, "quote"), eq(auditLog.entityId, quoteId)))
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(limit);
}

export async function findUser(
  db: Database,
  userId: string,
): Promise<{ id: string; name: string; email: string; role: string; banned: boolean } | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      banned: users.banned,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/** Plus ancien compte associé actif : agit pour le système quand l'auteur du devis n'existe plus. */
export async function findOldestAdmin(
  db: Database,
): Promise<{ id: string; name: string; email: string } | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.banned, false)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return row ?? null;
}
