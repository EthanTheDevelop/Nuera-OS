import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  companies,
  contracts,
  contractSites,
  directCosts,
  financialDocuments,
  paymentScheduleItems,
  projects,
  quotes,
  quoteVersions,
  sites,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, type PageParams, type Paginated } from "@/server/pagination";

/** Lectures du calcul de marge. Par lots : une page de rentabilité ne fait pas une requête par ligne. */

export interface PeriodFilter {
  from: string;
  to: string;
}

export interface ProjectTarget {
  id: string;
  companyId: string;
  name: string;
  number: string;
  status: string;
  quoteId: string | null;
  budgetCents: number | null;
}

export interface ContractTarget {
  id: string;
  companyId: string;
  name: string;
  number: string;
  status: string;
  quoteId: string | null;
  priceCents: number;
  period: "monthly" | "quarterly" | "yearly";
  monthlyCostCents: number | null;
  startOn: string | null;
  endOn: string | null;
}

const projectColumns = {
  id: projects.id,
  companyId: projects.companyId,
  name: projects.name,
  number: projects.number,
  status: projects.status,
  quoteId: projects.quoteId,
  budgetCents: projects.budgetCents,
};

const contractColumns = {
  id: contracts.id,
  companyId: contracts.companyId,
  name: contracts.name,
  number: contracts.number,
  status: contracts.status,
  quoteId: contracts.quoteId,
  priceCents: contracts.priceCents,
  period: contracts.period,
  monthlyCostCents: contracts.monthlyCostCents,
  startOn: contracts.startOn,
  endOn: contracts.endOn,
};

export async function loadProjects(db: Database, ids: readonly string[]): Promise<ProjectTarget[]> {
  if (ids.length === 0) return [];
  return db
    .select(projectColumns)
    .from(projects)
    .where(inArray(projects.id, [...ids]));
}

export async function loadContracts(
  db: Database,
  ids: readonly string[],
): Promise<ContractTarget[]> {
  if (ids.length === 0) return [];
  return db
    .select(contractColumns)
    .from(contracts)
    .where(inArray(contracts.id, [...ids]));
}

export async function loadSites(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: sites.id,
      companyId: sites.companyId,
      name: sites.name,
      primaryDomain: sites.primaryDomain,
      projectId: sites.projectId,
      contractId: sites.contractId,
    })
    .from(sites)
    .where(inArray(sites.id, [...ids]));
}

export async function loadCompanies(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, [...ids]));
}

export async function loadCompanyProjects(
  db: Database,
  companyIds: readonly string[],
): Promise<ProjectTarget[]> {
  if (companyIds.length === 0) return [];
  return db
    .select(projectColumns)
    .from(projects)
    .where(and(inArray(projects.companyId, [...companyIds]), sql`${projects.archivedAt} is null`));
}

export async function loadCompanyContracts(
  db: Database,
  companyIds: readonly string[],
): Promise<ContractTarget[]> {
  if (companyIds.length === 0) return [];
  return db
    .select(contractColumns)
    .from(contracts)
    .where(
      and(inArray(contracts.companyId, [...companyIds]), sql`${contracts.archivedAt} is null`),
    );
}

/** Sites couverts par chaque contrat : un revenu de contrat se répartit entre ses sites. */
export async function loadContractSiteLinks(db: Database, contractIds: readonly string[]) {
  if (contractIds.length === 0) return [];
  return db
    .select({ contractId: contractSites.contractId, siteId: contractSites.siteId })
    .from(contractSites)
    .where(inArray(contractSites.contractId, [...contractIds]));
}

export async function loadSiteContractLinks(db: Database, siteIds: readonly string[]) {
  if (siteIds.length === 0) return [];
  return db
    .select({ contractId: contractSites.contractId, siteId: contractSites.siteId })
    .from(contractSites)
    .where(inArray(contractSites.siteId, [...siteIds]));
}

export async function loadSitesWithContract(db: Database, contractIds: readonly string[]) {
  if (contractIds.length === 0) return [];
  return db
    .select({ contractId: sites.contractId, siteId: sites.id })
    .from(sites)
    .where(inArray(sites.contractId, [...contractIds]));
}

export interface DocumentGroup {
  companyId: string;
  projectId: string | null;
  contractId: string | null;
  kind: "invoice" | "credit_note";
  paid: boolean;
  cents: number;
  documents: number;
}

/** Factures et avoirs attribués, annulées exclues. Période : date d'émission. */
export async function loadDocumentGroups(
  db: Database,
  match: {
    companyIds?: readonly string[];
    projectIds?: readonly string[];
    contractIds?: readonly string[];
  },
  period?: PeriodFilter | null,
): Promise<DocumentGroup[]> {
  const conditions: (SQL | undefined)[] = [
    match.companyIds?.length
      ? inArray(financialDocuments.companyId, [...match.companyIds])
      : undefined,
    match.projectIds?.length
      ? inArray(financialDocuments.projectId, [...match.projectIds])
      : undefined,
    match.contractIds?.length
      ? inArray(financialDocuments.contractId, [...match.contractIds])
      : undefined,
  ];
  if (conditions.every((condition) => !condition)) return [];
  const paid = sql<boolean>`${financialDocuments.status} = 'paid'`;
  const rows = await db
    .select({
      companyId: financialDocuments.companyId,
      projectId: financialDocuments.projectId,
      contractId: financialDocuments.contractId,
      kind: financialDocuments.kind,
      paid,
      cents: sql<number>`sum(${financialDocuments.amountCents})::int`,
      documents: count(),
    })
    .from(financialDocuments)
    .where(
      and(
        or(...conditions),
        ne(financialDocuments.status, "cancelled"),
        period
          ? sql`${financialDocuments.issuedOn} between ${period.from}::date and ${period.to}::date`
          : undefined,
      ),
    )
    .groupBy(
      financialDocuments.companyId,
      financialDocuments.projectId,
      financialDocuments.contractId,
      financialDocuments.kind,
      paid,
    );
  return rows.map((row) => ({ ...row, cents: Number(row.cents) }));
}

export async function loadCostRows(
  db: Database,
  match: {
    companyIds?: readonly string[];
    projectIds?: readonly string[];
    contractIds?: readonly string[];
    siteIds?: readonly string[];
  },
) {
  const conditions: (SQL | undefined)[] = [
    match.companyIds?.length ? inArray(directCosts.companyId, [...match.companyIds]) : undefined,
    match.projectIds?.length ? inArray(directCosts.projectId, [...match.projectIds]) : undefined,
    match.contractIds?.length ? inArray(directCosts.contractId, [...match.contractIds]) : undefined,
    match.siteIds?.length ? inArray(directCosts.siteId, [...match.siteIds]) : undefined,
  ];
  if (conditions.every((condition) => !condition)) return [];
  return db
    .select({
      id: directCosts.id,
      companyId: directCosts.companyId,
      projectId: directCosts.projectId,
      siteId: directCosts.siteId,
      contractId: directCosts.contractId,
      label: directCosts.label,
      category: directCosts.category,
      amountCents: directCosts.amountCents,
      incurredOn: directCosts.incurredOn,
      recurringPeriod: directCosts.recurringPeriod,
      nature: directCosts.nature,
    })
    .from(directCosts)
    .where(and(or(...conditions), isNull(directCosts.archivedAt)));
}

export type CostRow = Awaited<ReturnType<typeof loadCostRows>>[number];

export interface QuoteFigures {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  estimatedCostCents: number;
  estimatedMinutes: number;
}

/** Version acceptée du devis, sinon sa version courante. */
export async function loadQuotes(db: Database, ids: readonly string[]): Promise<QuoteFigures[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      totalCents: quoteVersions.totalCents,
      estimatedCostCents: quoteVersions.estimatedCostCents,
      estimatedMinutes: quoteVersions.estimatedMinutes,
    })
    .from(quotes)
    .innerJoin(
      quoteVersions,
      eq(quoteVersions.id, sql`coalesce(${quotes.acceptedVersionId}, ${quotes.currentVersionId})`),
    )
    .where(inArray(quotes.id, [...ids]));
}

/** Parmi ces devis, ceux qui financent un projet. */
export async function loadQuoteIdsWithProject(
  db: Database,
  quoteIds: readonly string[],
): Promise<Set<string>> {
  if (quoteIds.length === 0) return new Set();
  const rows = await db
    .select({ quoteId: projects.quoteId })
    .from(projects)
    .where(inArray(projects.quoteId, [...quoteIds]));
  return new Set(rows.flatMap((row) => (row.quoteId ? [row.quoteId] : [])));
}

/** Échéances d'un projet tombant dans la période : le prévisionnel d'une période. */
export async function loadScheduleInPeriod(
  db: Database,
  projectIds: readonly string[],
  period: PeriodFilter,
) {
  if (projectIds.length === 0) return [];
  return db
    .select({
      projectId: paymentScheduleItems.projectId,
      amountCents: paymentScheduleItems.amountCents,
      label: paymentScheduleItems.label,
    })
    .from(paymentScheduleItems)
    .where(
      and(
        inArray(paymentScheduleItems.projectId, [...projectIds]),
        isNull(paymentScheduleItems.archivedAt),
        sql`${paymentScheduleItems.dueOn} between ${period.from}::date and ${period.to}::date`,
      ),
    );
}

// --- Listes de rentabilité ---------------------------------------------------------------------

export interface ProfitabilitySubject {
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  companyId: string;
}

function contains(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function listProjectSubjects(
  db: Database,
  search: string | null,
  params: PageParams,
): Promise<Paginated<ProfitabilitySubject>> {
  const where = and(
    sql`${projects.archivedAt} is null`,
    search
      ? or(
          sql`${projects.name} ilike ${contains(search)}`,
          sql`${projects.number} ilike ${contains(search)}`,
          sql`${companies.name} ilike ${contains(search)}`,
        )
      : undefined,
  );
  return paginate(params, {
    items: (limit, offset) =>
      db
        .select({
          id: projects.id,
          title: projects.name,
          subtitle: companies.name,
          status: projects.status,
          companyId: projects.companyId,
        })
        .from(projects)
        .innerJoin(companies, eq(companies.id, projects.companyId))
        .where(where)
        .orderBy(desc(projects.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(projects)
        .innerJoin(companies, eq(companies.id, projects.companyId))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

export async function listContractSubjects(
  db: Database,
  search: string | null,
  params: PageParams,
): Promise<Paginated<ProfitabilitySubject>> {
  const where = and(
    sql`${contracts.archivedAt} is null`,
    search
      ? or(
          sql`${contracts.name} ilike ${contains(search)}`,
          sql`${contracts.number} ilike ${contains(search)}`,
          sql`${companies.name} ilike ${contains(search)}`,
        )
      : undefined,
  );
  return paginate(params, {
    items: (limit, offset) =>
      db
        .select({
          id: contracts.id,
          title: contracts.name,
          subtitle: companies.name,
          status: contracts.status,
          companyId: contracts.companyId,
        })
        .from(contracts)
        .innerJoin(companies, eq(companies.id, contracts.companyId))
        .where(where)
        .orderBy(desc(contracts.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(contracts)
        .innerJoin(companies, eq(companies.id, contracts.companyId))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

export async function listSiteSubjects(
  db: Database,
  search: string | null,
  params: PageParams,
): Promise<Paginated<ProfitabilitySubject>> {
  const where = and(
    sql`${sites.archivedAt} is null`,
    search
      ? or(
          sql`${sites.name} ilike ${contains(search)}`,
          sql`${sites.primaryDomain} ilike ${contains(search)}`,
          sql`${companies.name} ilike ${contains(search)}`,
        )
      : undefined,
  );
  return paginate(params, {
    items: (limit, offset) =>
      db
        .select({
          id: sites.id,
          title: sql<string>`coalesce(${sites.primaryDomain}, ${sites.name})`,
          subtitle: companies.name,
          status: sites.status,
          companyId: sites.companyId,
        })
        .from(sites)
        .innerJoin(companies, eq(companies.id, sites.companyId))
        .where(where)
        .orderBy(asc(sites.name))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(sites)
        .innerJoin(companies, eq(companies.id, sites.companyId))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

/** Clients actifs (hors prospects sans historique), ceux qui ont le plus de revenus d'abord. */
export async function listClientSubjects(
  db: Database,
  search: string | null,
  params: PageParams,
): Promise<Paginated<ProfitabilitySubject>> {
  const revenue = sql<number>`(select coalesce(sum(d.amount_cents), 0) from ${financialDocuments} d where d.company_id = ${companies.id} and d.status <> 'cancelled')`;
  const where = and(
    sql`${companies.archivedAt} is null`,
    sql`${companies.status} <> 'prospect'`,
    search ? sql`${companies.name} ilike ${contains(search)}` : undefined,
  );
  return paginate(params, {
    items: (limit, offset) =>
      db
        .select({
          id: companies.id,
          title: companies.name,
          subtitle: sql<string | null>`null`,
          status: companies.status,
          companyId: companies.id,
        })
        .from(companies)
        .where(where)
        .orderBy(sql`${revenue} desc`, asc(companies.name))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db.select({ total: count() }).from(companies).where(where);
      return row?.total ?? 0;
    },
  });
}

/** Clients et projets qui ont au moins une facture : les seuls dont une marge réelle se calcule. */
export async function listProjectIdsWithInvoices(db: Database, limit: number): Promise<string[]> {
  const rows = await db
    .select({ projectId: financialDocuments.projectId })
    .from(financialDocuments)
    .where(
      and(
        sql`${financialDocuments.projectId} is not null`,
        ne(financialDocuments.status, "cancelled"),
      ),
    )
    .groupBy(financialDocuments.projectId)
    .orderBy(sql`max(${financialDocuments.issuedOn}) desc nulls last`)
    .limit(limit);
  return rows.flatMap((row) => (row.projectId ? [row.projectId] : []));
}
