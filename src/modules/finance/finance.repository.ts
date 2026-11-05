import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type {
  CostCategory,
  CostNature,
  FinancialDocumentKind,
  FinancialDocumentSource,
  FinancialDocumentStatus,
  ScheduleItemStatus,
} from "@/lib/domain-enums";
import { contracts, documents, projects, quotes, quoteVersions, sites } from "@/server/db/schema";
import {
  companies,
  directCosts,
  financeImports,
  financialDocuments,
  integrationConnections,
  paymentScheduleItems,
  teamMembers,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, type PageParams, type Paginated } from "@/server/pagination";
import { formatDateNumeric } from "@/lib/format";

/** Requêtes Drizzle des factures, échéances, coûts et imports. Ni règle métier ni contrôle d'accès. */

export type FinancialDocumentInsert = typeof financialDocuments.$inferInsert;
export type ScheduleItemInsert = typeof paymentScheduleItems.$inferInsert;
export type DirectCostInsert = typeof directCosts.$inferInsert;
export type FinanceImportInsert = typeof financeImports.$inferInsert;

/** Recherche `ILIKE` littérale : `%` et `_` saisis ne sont pas des jokers. */
function contains(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Une facture émise dont l'échéance est passée est en retard, même si la tâche n'a pas encore tourné. */
export function isPastDue(today: string): SQL {
  return sql`(${financialDocuments.status} = 'issued' and ${financialDocuments.kind} = 'invoice' and ${financialDocuments.dueOn} < ${today}::date)`;
}

function displayedStatus(today: string) {
  return sql<FinancialDocumentStatus>`case when ${isPastDue(today)} then 'overdue' else ${financialDocuments.status} end`;
}

const invoiceColumns = (today: string) => ({
  id: financialDocuments.id,
  companyId: financialDocuments.companyId,
  companyName: companies.name,
  projectId: financialDocuments.projectId,
  projectName: projects.name,
  projectNumber: projects.number,
  contractId: financialDocuments.contractId,
  contractName: contracts.name,
  contractNumber: contracts.number,
  quoteId: financialDocuments.quoteId,
  quoteNumber: quotes.number,
  scheduleItemId: financialDocuments.scheduleItemId,
  scheduleLabel: paymentScheduleItems.label,
  kind: financialDocuments.kind,
  source: financialDocuments.source,
  externalRef: financialDocuments.externalRef,
  issuerMemberId: financialDocuments.issuerMemberId,
  issuerName: teamMembers.fullName,
  issuedOn: financialDocuments.issuedOn,
  dueOn: financialDocuments.dueOn,
  amountCents: financialDocuments.amountCents,
  taxCents: financialDocuments.taxCents,
  /** Statut lu, retard calculé compris. Le statut en base reste `storedStatus`. */
  status: displayedStatus(today),
  storedStatus: financialDocuments.status,
  paidOn: financialDocuments.paidOn,
  documentId: financialDocuments.documentId,
  documentTitle: documents.title,
  clientVisible: financialDocuments.clientVisible,
  importedAt: financialDocuments.importedAt,
  createdAt: financialDocuments.createdAt,
});

export interface InvoiceRow {
  id: string;
  companyId: string;
  companyName: string;
  projectId: string | null;
  projectName: string | null;
  projectNumber: string | null;
  contractId: string | null;
  contractName: string | null;
  contractNumber: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  scheduleItemId: string | null;
  scheduleLabel: string | null;
  kind: FinancialDocumentKind;
  source: FinancialDocumentSource;
  externalRef: string | null;
  issuerMemberId: string | null;
  issuerName: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  amountCents: number;
  taxCents: number;
  status: FinancialDocumentStatus;
  storedStatus: FinancialDocumentStatus;
  paidOn: string | null;
  documentId: string | null;
  documentTitle: string | null;
  clientVisible: boolean;
  importedAt: Date | null;
  createdAt: Date;
}

function invoiceQuery(db: Database, today: string) {
  return db
    .select(invoiceColumns(today))
    .from(financialDocuments)
    .innerJoin(companies, eq(companies.id, financialDocuments.companyId))
    .leftJoin(projects, eq(projects.id, financialDocuments.projectId))
    .leftJoin(contracts, eq(contracts.id, financialDocuments.contractId))
    .leftJoin(quotes, eq(quotes.id, financialDocuments.quoteId))
    .leftJoin(paymentScheduleItems, eq(paymentScheduleItems.id, financialDocuments.scheduleItemId))
    .leftJoin(teamMembers, eq(teamMembers.id, financialDocuments.issuerMemberId))
    .leftJoin(documents, eq(documents.id, financialDocuments.documentId));
}

export interface InvoiceListFilter {
  status?: FinancialDocumentStatus | null;
  search?: string | null;
  companyId?: string;
  projectId?: string;
  contractId?: string;
  scheduleItemId?: string;
  onlyClientVisible?: boolean;
}

function invoiceWhere(filter: InvoiceListFilter, today: string): SQL | undefined {
  const search = filter.search?.trim();
  let status: SQL | undefined;
  if (filter.status === "overdue") {
    status = or(eq(financialDocuments.status, "overdue"), isPastDue(today));
  } else if (filter.status === "issued") {
    status = and(eq(financialDocuments.status, "issued"), sql`not ${isPastDue(today)}`);
  } else if (filter.status) {
    status = eq(financialDocuments.status, filter.status);
  }
  return and(
    status,
    filter.companyId ? eq(financialDocuments.companyId, filter.companyId) : undefined,
    filter.projectId ? eq(financialDocuments.projectId, filter.projectId) : undefined,
    filter.contractId ? eq(financialDocuments.contractId, filter.contractId) : undefined,
    filter.scheduleItemId
      ? eq(financialDocuments.scheduleItemId, filter.scheduleItemId)
      : undefined,
    filter.onlyClientVisible ? eq(financialDocuments.clientVisible, true) : undefined,
    search
      ? or(
          sql`${financialDocuments.externalRef} ilike ${contains(search)}`,
          sql`${companies.name} ilike ${contains(search)}`,
          sql`${projects.name} ilike ${contains(search)}`,
        )
      : undefined,
  );
}

/** Les factures d'une même échéance restent côte à côte : elles arrivent ensemble (note 21). */
const INVOICE_ORDER = [
  sql`${financialDocuments.issuedOn} desc nulls last`,
  asc(financialDocuments.scheduleItemId),
  asc(financialDocuments.externalRef),
];

export async function listInvoices(
  db: Database,
  filter: InvoiceListFilter,
  params: PageParams,
  today: string,
): Promise<Paginated<InvoiceRow>> {
  const where = invoiceWhere(filter, today);
  return paginate(params, {
    items: (limit, offset) =>
      invoiceQuery(db, today)
        .where(where)
        .orderBy(...INVOICE_ORDER)
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(financialDocuments)
        .innerJoin(companies, eq(companies.id, financialDocuments.companyId))
        .leftJoin(projects, eq(projects.id, financialDocuments.projectId))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

export async function getInvoiceRow(
  db: Database,
  id: string,
  today: string,
): Promise<InvoiceRow | null> {
  const [row] = await invoiceQuery(db, today).where(eq(financialDocuments.id, id)).limit(1);
  return row ?? null;
}

export async function listInvoicesLimited(
  db: Database,
  filter: InvoiceListFilter,
  limit: number,
  today: string,
): Promise<InvoiceRow[]> {
  return invoiceQuery(db, today)
    .where(invoiceWhere(filter, today))
    .orderBy(...INVOICE_ORDER)
    .limit(limit);
}

export async function listOverdueRows(
  db: Database,
  today: string,
  limit = 500,
): Promise<InvoiceRow[]> {
  return invoiceQuery(db, today)
    .where(
      and(
        eq(financialDocuments.kind, "invoice"),
        or(eq(financialDocuments.status, "overdue"), isPastDue(today)),
      ),
    )
    .orderBy(asc(financialDocuments.dueOn), asc(financialDocuments.externalRef))
    .limit(limit);
}

export async function getDocument(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(financialDocuments)
    .where(eq(financialDocuments.id, id))
    .limit(1);
  return row ?? null;
}

/** Une référence déjà connue, quelle que soit sa source : import et saisie se rapprochent. */
export async function findDocumentsByRefs(db: Database, refs: readonly string[]) {
  if (refs.length === 0) return [];
  return db
    .select()
    .from(financialDocuments)
    .where(inArray(financialDocuments.externalRef, [...refs]));
}

export async function insertDocument(db: Database, values: FinancialDocumentInsert) {
  const [row] = await db.insert(financialDocuments).values(values).returning();
  if (!row) throw new Error("Insertion de la facture sans résultat.");
  return row;
}

export async function updateDocument(
  db: Database,
  id: string,
  values: Partial<FinancialDocumentInsert>,
) {
  const [row] = await db
    .update(financialDocuments)
    .set(values)
    .where(eq(financialDocuments.id, id))
    .returning();
  return row ?? null;
}

/** Changement d'état atomique : `null` si un autre traitement est passé avant. */
export async function transitionDocument(
  db: Database,
  id: string,
  from: FinancialDocumentStatus,
  values: Partial<FinancialDocumentInsert>,
) {
  const [row] = await db
    .update(financialDocuments)
    .set(values)
    .where(and(eq(financialDocuments.id, id), eq(financialDocuments.status, from)))
    .returning();
  return row ?? null;
}

/** Factures émises dont l'échéance est passée : matière de la tâche quotidienne. */
export async function listDocumentsToMarkOverdue(db: Database, today: string) {
  return db.select().from(financialDocuments).where(isPastDue(today));
}

// --- Liens d'un même client --------------------------------------------------------------------

export async function companyExists(db: Database, id: string): Promise<boolean> {
  const [row] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id));
  return Boolean(row);
}

export interface LinkCheck {
  companyId: string;
  projectId?: string | null;
  contractId?: string | null;
  quoteId?: string | null;
  siteId?: string | null;
  scheduleItemId?: string | null;
  documentId?: string | null;
}

/** Champs dont l'objet lié n'appartient pas au client indiqué. */
export async function findForeignLinks(db: Database, link: LinkCheck): Promise<string[]> {
  // Une à une : appelée dans une transaction, qui ne lit qu'une requête à la fois.
  const foreign: string[] = [];
  const check = async (field: string, query: Promise<{ companyId: string | null }[]>) => {
    const [row] = await query;
    if (row?.companyId !== link.companyId) foreign.push(field);
  };

  if (link.projectId) {
    await check(
      "projectId",
      db
        .select({ companyId: projects.companyId })
        .from(projects)
        .where(eq(projects.id, link.projectId)),
    );
  }
  if (link.contractId) {
    await check(
      "contractId",
      db
        .select({ companyId: contracts.companyId })
        .from(contracts)
        .where(eq(contracts.id, link.contractId)),
    );
  }
  if (link.quoteId) {
    await check(
      "quoteId",
      db.select({ companyId: quotes.companyId }).from(quotes).where(eq(quotes.id, link.quoteId)),
    );
  }
  if (link.siteId) {
    await check(
      "siteId",
      db.select({ companyId: sites.companyId }).from(sites).where(eq(sites.id, link.siteId)),
    );
  }
  if (link.scheduleItemId) {
    await check(
      "scheduleItemId",
      db
        .select({ companyId: paymentScheduleItems.companyId })
        .from(paymentScheduleItems)
        .where(
          and(
            eq(paymentScheduleItems.id, link.scheduleItemId),
            isNull(paymentScheduleItems.archivedAt),
          ),
        ),
    );
  }
  if (link.documentId) {
    await check(
      "documentId",
      db
        .select({ companyId: documents.companyId })
        .from(documents)
        .where(eq(documents.id, link.documentId)),
    );
  }
  return foreign;
}

export interface CompanyLinks {
  projects: { id: string; label: string }[];
  contracts: { id: string; label: string }[];
  quotes: { id: string; label: string }[];
  sites: { id: string; label: string }[];
  scheduleItems: { id: string; label: string }[];
  documents: { id: string; label: string }[];
}

export async function listCompanyLinks(db: Database, companyId: string): Promise<CompanyLinks> {
  const [projectRows, contractRows, quoteRows, siteRows, scheduleRows, documentRows] =
    await Promise.all([
      db
        .select({ id: projects.id, number: projects.number, name: projects.name })
        .from(projects)
        .where(and(eq(projects.companyId, companyId), sql`${projects.archivedAt} is null`))
        .orderBy(desc(projects.createdAt))
        .limit(100),
      db
        .select({ id: contracts.id, number: contracts.number, name: contracts.name })
        .from(contracts)
        .where(and(eq(contracts.companyId, companyId), sql`${contracts.archivedAt} is null`))
        .orderBy(desc(contracts.createdAt))
        .limit(100),
      db
        .select({ id: quotes.id, number: quotes.number, title: quotes.title })
        .from(quotes)
        .where(and(eq(quotes.companyId, companyId), sql`${quotes.archivedAt} is null`))
        .orderBy(desc(quotes.createdAt))
        .limit(100),
      db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(and(eq(sites.companyId, companyId), sql`${sites.archivedAt} is null`))
        .orderBy(asc(sites.name))
        .limit(100),
      db
        .select({
          id: paymentScheduleItems.id,
          label: paymentScheduleItems.label,
          dueOn: paymentScheduleItems.dueOn,
        })
        .from(paymentScheduleItems)
        .where(
          and(
            eq(paymentScheduleItems.companyId, companyId),
            isNull(paymentScheduleItems.archivedAt),
          ),
        )
        .orderBy(sql`${paymentScheduleItems.dueOn} desc nulls last`)
        .limit(100),
      db
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, companyId),
            eq(documents.kind, "invoice"),
            sql`${documents.archivedAt} is null`,
          ),
        )
        .orderBy(desc(documents.createdAt))
        .limit(100),
    ]);
  return {
    projects: projectRows.map((row) => ({ id: row.id, label: `${row.number} · ${row.name}` })),
    contracts: contractRows.map((row) => ({ id: row.id, label: `${row.number} · ${row.name}` })),
    quotes: quoteRows.map((row) => ({ id: row.id, label: `${row.number} · ${row.title}` })),
    sites: siteRows.map((row) => ({ id: row.id, label: row.name })),
    scheduleItems: scheduleRows.map((row) => ({
      id: row.id,
      label: row.dueOn ? `${row.label} · ${formatDateNumeric(row.dueOn)}` : row.label,
    })),
    documents: documentRows.map((row) => ({ id: row.id, label: row.title })),
  };
}

// --- Échéances ---------------------------------------------------------------------------------

/** Factures vivantes d'une échéance : montants et état. */
export async function scheduleDocumentTotals(db: Database, scheduleItemId: string) {
  const [row] = await db
    .select({
      liveCount: count(),
      liveCents: sql<number>`coalesce(sum(${financialDocuments.amountCents}), 0)::int`,
      paidCents: sql<number>`coalesce(sum(${financialDocuments.amountCents}) filter (where ${financialDocuments.status} = 'paid'), 0)::int`,
      firstDocumentId: sql<
        string | null
      >`(array_agg(${financialDocuments.id} order by ${financialDocuments.createdAt}))[1]`,
    })
    .from(financialDocuments)
    .where(
      and(
        eq(financialDocuments.scheduleItemId, scheduleItemId),
        ne(financialDocuments.status, "cancelled"),
      ),
    );
  return {
    liveCount: row?.liveCount ?? 0,
    liveCents: Number(row?.liveCents ?? 0),
    paidCents: Number(row?.paidCents ?? 0),
    firstDocumentId: row?.firstDocumentId ?? null,
  };
}

export async function getScheduleItem(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(paymentScheduleItems)
    .where(and(eq(paymentScheduleItems.id, id), isNull(paymentScheduleItems.archivedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Lecture verrouillée. Deux transactions sur une même échéance (deux factures d'associés, deux
 * paiements) se succèdent : la seconde lit les totaux de la première au lieu de les écraser.
 */
export async function getScheduleItemForUpdate(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(paymentScheduleItems)
    .where(and(eq(paymentScheduleItems.id, id), isNull(paymentScheduleItems.archivedAt)))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function insertScheduleItem(db: Database, values: ScheduleItemInsert) {
  const [row] = await db.insert(paymentScheduleItems).values(values).returning();
  if (!row) throw new Error("Insertion de l'échéance sans résultat.");
  return row;
}

export async function updateScheduleItem(
  db: Database,
  id: string,
  values: Partial<ScheduleItemInsert>,
) {
  const [row] = await db
    .update(paymentScheduleItems)
    .set(values)
    .where(eq(paymentScheduleItems.id, id))
    .returning();
  return row ?? null;
}

export async function archiveScheduleItem(db: Database, id: string): Promise<void> {
  await db
    .update(paymentScheduleItems)
    .set({ archivedAt: new Date() })
    .where(eq(paymentScheduleItems.id, id));
}

export async function countScheduleDocuments(db: Database, id: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(financialDocuments)
    .where(eq(financialDocuments.scheduleItemId, id));
  return row?.total ?? 0;
}

const scheduleColumns = {
  id: paymentScheduleItems.id,
  companyId: paymentScheduleItems.companyId,
  companyName: companies.name,
  projectId: paymentScheduleItems.projectId,
  projectName: projects.name,
  contractId: paymentScheduleItems.contractId,
  contractName: contracts.name,
  quoteId: paymentScheduleItems.quoteId,
  label: paymentScheduleItems.label,
  dueOn: paymentScheduleItems.dueOn,
  amountCents: paymentScheduleItems.amountCents,
  status: paymentScheduleItems.status,
  documentCount: sql<number>`(select count(*)::int from ${financialDocuments} d where d.schedule_item_id = ${paymentScheduleItems.id} and d.status <> 'cancelled')`,
  invoicedCents: sql<number>`(select coalesce(sum(d.amount_cents), 0)::int from ${financialDocuments} d where d.schedule_item_id = ${paymentScheduleItems.id} and d.status <> 'cancelled')`,
};

export interface ScheduleRow {
  id: string;
  companyId: string;
  companyName: string;
  projectId: string | null;
  projectName: string | null;
  contractId: string | null;
  contractName: string | null;
  quoteId: string | null;
  label: string;
  dueOn: string | null;
  amountCents: number;
  status: ScheduleItemStatus;
  documentCount: number;
  invoicedCents: number;
}

function scheduleQuery(db: Database) {
  return db
    .select(scheduleColumns)
    .from(paymentScheduleItems)
    .innerJoin(companies, eq(companies.id, paymentScheduleItems.companyId))
    .leftJoin(projects, eq(projects.id, paymentScheduleItems.projectId))
    .leftJoin(contracts, eq(contracts.id, paymentScheduleItems.contractId));
}

export async function listScheduleItems(
  db: Database,
  filter: { status?: ScheduleItemStatus | null; search?: string | null },
  params: PageParams,
): Promise<Paginated<ScheduleRow>> {
  const search = filter.search?.trim();
  const where = and(
    isNull(paymentScheduleItems.archivedAt),
    filter.status ? eq(paymentScheduleItems.status, filter.status) : undefined,
    search
      ? or(
          sql`${paymentScheduleItems.label} ilike ${contains(search)}`,
          sql`${companies.name} ilike ${contains(search)}`,
          sql`${projects.name} ilike ${contains(search)}`,
        )
      : undefined,
  );
  return paginate(params, {
    items: (limit, offset) =>
      scheduleQuery(db)
        .where(where)
        .orderBy(sql`${paymentScheduleItems.dueOn} asc nulls last`, asc(paymentScheduleItems.label))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(paymentScheduleItems)
        .innerJoin(companies, eq(companies.id, paymentScheduleItems.companyId))
        .leftJoin(projects, eq(projects.id, paymentScheduleItems.projectId))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

export async function getScheduleRow(db: Database, id: string): Promise<ScheduleRow | null> {
  const [row] = await scheduleQuery(db)
    .where(and(eq(paymentScheduleItems.id, id), isNull(paymentScheduleItems.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Prochaines échéances à encaisser : toutes celles qui ne sont pas encore payées. */
export async function listUpcomingSchedule(db: Database, limit: number): Promise<ScheduleRow[]> {
  return scheduleQuery(db)
    .where(and(ne(paymentScheduleItems.status, "paid"), isNull(paymentScheduleItems.archivedAt)))
    .orderBy(sql`${paymentScheduleItems.dueOn} asc nulls last`, asc(paymentScheduleItems.label))
    .limit(limit);
}

// --- Coûts directs -----------------------------------------------------------------------------

export async function getDirectCost(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(directCosts)
    .where(and(eq(directCosts.id, id), isNull(directCosts.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function insertDirectCost(db: Database, values: DirectCostInsert) {
  const [row] = await db.insert(directCosts).values(values).returning();
  if (!row) throw new Error("Insertion du coût sans résultat.");
  return row;
}

export async function updateDirectCost(
  db: Database,
  id: string,
  values: Partial<DirectCostInsert>,
) {
  const [row] = await db.update(directCosts).set(values).where(eq(directCosts.id, id)).returning();
  return row ?? null;
}

export async function archiveDirectCost(db: Database, id: string): Promise<void> {
  await db.update(directCosts).set({ archivedAt: new Date() }).where(eq(directCosts.id, id));
}

export interface DirectCostRow {
  id: string;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  projectName: string | null;
  siteId: string | null;
  siteName: string | null;
  contractId: string | null;
  contractName: string | null;
  memberId: string | null;
  memberName: string | null;
  label: string;
  category: CostCategory;
  amountCents: number;
  incurredOn: string;
  recurringPeriod: "monthly" | "quarterly" | "yearly" | null;
  nature: CostNature;
}

function costQuery(db: Database) {
  return db
    .select({
      id: directCosts.id,
      companyId: directCosts.companyId,
      companyName: companies.name,
      projectId: directCosts.projectId,
      projectName: projects.name,
      siteId: directCosts.siteId,
      siteName: sites.name,
      contractId: directCosts.contractId,
      contractName: contracts.name,
      memberId: directCosts.memberId,
      memberName: teamMembers.fullName,
      label: directCosts.label,
      category: directCosts.category,
      amountCents: directCosts.amountCents,
      incurredOn: directCosts.incurredOn,
      recurringPeriod: directCosts.recurringPeriod,
      nature: directCosts.nature,
    })
    .from(directCosts)
    .leftJoin(companies, eq(companies.id, directCosts.companyId))
    .leftJoin(projects, eq(projects.id, directCosts.projectId))
    .leftJoin(sites, eq(sites.id, directCosts.siteId))
    .leftJoin(contracts, eq(contracts.id, directCosts.contractId))
    .leftJoin(teamMembers, eq(teamMembers.id, directCosts.memberId));
}

export interface CostListFilter {
  nature?: CostNature | null;
  category?: CostCategory | null;
  recurring?: "yes" | "no" | null;
  search?: string | null;
}

export async function listDirectCosts(
  db: Database,
  filter: CostListFilter,
  params: PageParams,
): Promise<Paginated<DirectCostRow>> {
  const search = filter.search?.trim();
  const where = and(
    isNull(directCosts.archivedAt),
    filter.nature ? eq(directCosts.nature, filter.nature) : undefined,
    filter.category ? eq(directCosts.category, filter.category) : undefined,
    filter.recurring === "yes" ? isNotNull(directCosts.recurringPeriod) : undefined,
    filter.recurring === "no" ? sql`${directCosts.recurringPeriod} is null` : undefined,
    search
      ? or(
          sql`${directCosts.label} ilike ${contains(search)}`,
          sql`${companies.name} ilike ${contains(search)}`,
          sql`${projects.name} ilike ${contains(search)}`,
        )
      : undefined,
  );
  return paginate(params, {
    items: (limit, offset) =>
      costQuery(db)
        .where(where)
        .orderBy(desc(directCosts.incurredOn), asc(directCosts.label))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(directCosts)
        .leftJoin(companies, eq(companies.id, directCosts.companyId))
        .leftJoin(projects, eq(projects.id, directCosts.projectId))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

export async function getDirectCostRow(db: Database, id: string): Promise<DirectCostRow | null> {
  const [row] = await costQuery(db)
    .where(and(eq(directCosts.id, id), isNull(directCosts.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Coûts récurrents réalisés, les plus lourds d'abord. */
export async function listRecurringCostRows(db: Database): Promise<DirectCostRow[]> {
  return costQuery(db)
    .where(
      and(
        isNotNull(directCosts.recurringPeriod),
        eq(directCosts.nature, "actual"),
        isNull(directCosts.archivedAt),
      ),
    )
    .orderBy(desc(directCosts.amountCents), asc(directCosts.label))
    .limit(500);
}

/** Contrats en cours de facturation, avec leurs coûts récurrents réalisés. */
export async function listRunningContractsWithCosts(db: Database) {
  const [contractRows, costRows] = await Promise.all([
    db
      .select({
        id: contracts.id,
        number: contracts.number,
        name: contracts.name,
        companyId: contracts.companyId,
        companyName: companies.name,
        priceCents: contracts.priceCents,
        period: contracts.period,
        monthlyCostCents: contracts.monthlyCostCents,
      })
      .from(contracts)
      .innerJoin(companies, eq(companies.id, contracts.companyId))
      .where(
        and(
          inArray(contracts.status, ["active", "to_review"]),
          sql`${contracts.archivedAt} is null`,
        ),
      )
      .limit(2000),
    db
      .select({
        contractId: directCosts.contractId,
        amountCents: directCosts.amountCents,
        recurringPeriod: directCosts.recurringPeriod,
      })
      .from(directCosts)
      .where(
        and(
          isNotNull(directCosts.contractId),
          isNotNull(directCosts.recurringPeriod),
          eq(directCosts.nature, "actual"),
          isNull(directCosts.archivedAt),
        ),
      ),
  ]);
  return { contractRows, costRows };
}

// --- Synthèse ----------------------------------------------------------------------------------

export async function sumCollected(db: Database, range: { from: string; to: string }) {
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(sum(${financialDocuments.amountCents}), 0)::int`,
      documents: count(),
    })
    .from(financialDocuments)
    .where(
      and(
        eq(financialDocuments.status, "paid"),
        sql`${financialDocuments.paidOn} between ${range.from}::date and ${range.to}::date`,
      ),
    );
  return { cents: Number(row?.cents ?? 0), documents: row?.documents ?? 0 };
}

export async function sumInvoiced(db: Database, range: { from: string; to: string }) {
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${financialDocuments.amountCents}), 0)::int` })
    .from(financialDocuments)
    .where(
      and(
        ne(financialDocuments.status, "cancelled"),
        sql`${financialDocuments.issuedOn} between ${range.from}::date and ${range.to}::date`,
      ),
    );
  return Number(row?.cents ?? 0);
}

/** Reste à encaisser, retard à part : les deux ne se recouvrent pas. */
export async function sumOpenInvoices(db: Database, today: string) {
  const [row] = await db
    .select({
      openCents: sql<number>`coalesce(sum(${financialDocuments.amountCents}) filter (where ${financialDocuments.status} = 'issued' and not ${isPastDue(today)}), 0)::int`,
      openCount: sql<number>`count(*) filter (where ${financialDocuments.status} = 'issued' and not ${isPastDue(today)})::int`,
      overdueCents: sql<number>`coalesce(sum(${financialDocuments.amountCents}) filter (where ${financialDocuments.status} = 'overdue' or ${isPastDue(today)}), 0)::int`,
      overdueCount: sql<number>`count(*) filter (where ${financialDocuments.status} = 'overdue' or ${isPastDue(today)})::int`,
    })
    .from(financialDocuments)
    .where(inArray(financialDocuments.status, ["issued", "overdue"]));
  return {
    openCents: Number(row?.openCents ?? 0),
    openCount: Number(row?.openCount ?? 0),
    overdueCents: Number(row?.overdueCents ?? 0),
    overdueCount: Number(row?.overdueCount ?? 0),
  };
}

/** Encaissements mensuels par associé émetteur : l'info-bulle donne la part de chacun. */
export async function collectedByMonthAndIssuer(db: Database, range: { from: string; to: string }) {
  const rows = await db
    .select({
      month: sql<string>`to_char(${financialDocuments.paidOn}, 'YYYY-MM')`,
      issuerMemberId: financialDocuments.issuerMemberId,
      issuerName: teamMembers.fullName,
      cents: sql<number>`sum(${financialDocuments.amountCents})::int`,
    })
    .from(financialDocuments)
    .leftJoin(teamMembers, eq(teamMembers.id, financialDocuments.issuerMemberId))
    .where(
      and(
        eq(financialDocuments.status, "paid"),
        sql`${financialDocuments.paidOn} between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .groupBy(
      sql`to_char(${financialDocuments.paidOn}, 'YYYY-MM')`,
      financialDocuments.issuerMemberId,
      teamMembers.fullName,
    );
  return rows.map((row) => ({ ...row, cents: Number(row.cents) }));
}

/** Nombre maximal de factures sur une échéance encaissée dans la période (co-traitance). */
export async function maxDocumentsPerScheduleItem(
  db: Database,
  range: { from: string; to: string },
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(financialDocuments)
    .where(
      and(
        isNotNull(financialDocuments.scheduleItemId),
        eq(financialDocuments.status, "paid"),
        sql`${financialDocuments.paidOn} between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .groupBy(financialDocuments.scheduleItemId);
  return rows.reduce((max, row) => Math.max(max, row.total), 0);
}

/**
 * Ce qu'il reste à facturer sur les échéances non payées : la part déjà facturée compte dans le reste
 * à encaisser, jamais deux fois, et une échéance à moitié facturée (co-traitance) garde son solde.
 */
export async function sumPlannedSchedule(db: Database) {
  const remaining = sql`greatest(${paymentScheduleItems.amountCents} - coalesce((
    select sum(d.amount_cents) from financial_documents d
    where d.schedule_item_id = "payment_schedule_items"."id" and d.status <> 'cancelled'
  ), 0), 0)`;
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(sum(${remaining}), 0)::int`,
      items: sql<number>`count(*) filter (where ${remaining} > 0)::int`,
    })
    .from(paymentScheduleItems)
    .where(and(ne(paymentScheduleItems.status, "paid"), isNull(paymentScheduleItems.archivedAt)));
  return { cents: Number(row?.cents ?? 0), items: Number(row?.items ?? 0) };
}

/** Devis envoyés, non signés : du prévisionnel, jamais additionné au certain. */
export async function sumOpenQuotes(db: Database) {
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(sum(${quoteVersions.totalCents}), 0)::int`,
      quotes: count(),
    })
    .from(quotes)
    .innerJoin(quoteVersions, eq(quoteVersions.id, quotes.currentVersionId))
    .where(and(inArray(quotes.status, ["sent", "negotiation"]), sql`${quotes.archivedAt} is null`));
  return { cents: Number(row?.cents ?? 0), quotes: row?.quotes ?? 0 };
}

export async function listRunningContractPrices(db: Database) {
  return db
    .select({ priceCents: contracts.priceCents, period: contracts.period })
    .from(contracts)
    .where(
      and(inArray(contracts.status, ["active", "to_review"]), sql`${contracts.archivedAt} is null`),
    );
}

// --- Imports et connexion ----------------------------------------------------------------------

export async function insertImport(db: Database, values: FinanceImportInsert) {
  const [row] = await db.insert(financeImports).values(values).returning();
  if (!row) throw new Error("Insertion de l'import sans résultat.");
  return row;
}

export async function getImport(db: Database, id: string) {
  const [row] = await db.select().from(financeImports).where(eq(financeImports.id, id)).limit(1);
  return row ?? null;
}

export async function listImports(db: Database, params: PageParams) {
  return paginate(params, {
    items: (limit, offset) =>
      db.select().from(financeImports).orderBy(desc(financeImports.at)).limit(limit).offset(offset),
    count: () => db.$count(financeImports),
  });
}

export async function getLastImport(db: Database) {
  const [row] = await db.select().from(financeImports).orderBy(desc(financeImports.at)).limit(1);
  return row ?? null;
}

export async function countDocuments(db: Database): Promise<number> {
  return db.$count(financialDocuments);
}

export async function getIndyConnection(db: Database) {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.service, "indy"))
    .limit(1);
  return row ?? null;
}

/**
 * Un import réussi renseigne la connexion : l'état reste « API à vérifier » (A11), seule la date de
 * dernière lecture change. Le chemin réel est le fichier, pas une API.
 */
export async function recordIndyImportOnConnection(
  db: Database,
  values: { at: Date; details: Record<string, unknown> },
): Promise<void> {
  await db
    .insert(integrationConnections)
    .values({
      service: "indy",
      status: "to_verify",
      lastCheckAt: values.at,
      lastSuccessAt: values.at,
      details: values.details,
    })
    .onConflictDoUpdate({
      target: integrationConnections.service,
      set: {
        status: "to_verify",
        lastCheckAt: values.at,
        lastSuccessAt: values.at,
        details: values.details,
      },
    });
}

// --- Lectures pour l'import --------------------------------------------------------------------

/** Une requête à la fois : l'import lit ces tables dans sa transaction. */
export async function loadImportLookups(db: Database) {
  const companyRows = await db
    .select({ id: companies.id, name: companies.name, siren: companies.siren })
    .from(companies)
    .where(sql`${companies.archivedAt} is null`);
  const projectRows = await db
    .select({
      id: projects.id,
      number: projects.number,
      name: projects.name,
      companyId: projects.companyId,
    })
    .from(projects);
  const contractRows = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      name: contracts.name,
      companyId: contracts.companyId,
    })
    .from(contracts);
  const memberRows = await db
    .select({
      id: teamMembers.id,
      fullName: teamMembers.fullName,
      email: teamMembers.email,
      kind: teamMembers.kind,
    })
    .from(teamMembers);
  return { companyRows, projectRows, contractRows, memberRows };
}

/** Associés actifs : eux seuls émettent une facture (A12). */
export async function listIssuerOptions(db: Database) {
  return db
    .select({ id: teamMembers.id, fullName: teamMembers.fullName, kind: teamMembers.kind })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.kind, "partner"),
        eq(teamMembers.status, "active"),
        sql`${teamMembers.archivedAt} is null`,
      ),
    )
    .orderBy(asc(teamMembers.fullName));
}

/** Tous les intervenants actifs, prestataires compris : rattachement d'un coût. */
export async function listMemberOptions(db: Database) {
  return db
    .select({ id: teamMembers.id, fullName: teamMembers.fullName, kind: teamMembers.kind })
    .from(teamMembers)
    .where(and(eq(teamMembers.status, "active"), sql`${teamMembers.archivedAt} is null`))
    .orderBy(sql`${teamMembers.kind} = 'partner' desc`, asc(teamMembers.fullName));
}

export async function getMemberForChoice(db: Database, id: string) {
  const [row] = await db
    .select({
      kind: teamMembers.kind,
      status: teamMembers.status,
      archivedAt: teamMembers.archivedAt,
    })
    .from(teamMembers)
    .where(eq(teamMembers.id, id))
    .limit(1);
  return row ?? null;
}
