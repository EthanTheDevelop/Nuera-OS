import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { ContractKind, ContractStatus } from "@/lib/domain-enums";
import {
  changeRequests,
  companies,
  contractEvents,
  contracts,
  contractSites,
  directCosts,
  domains,
  maintenanceInterventions,
  maintenancePlans,
  paymentScheduleItems,
  quotes,
  sites,
  teamMembers,
  tickets,
  users,
  type Contract,
  type MaintenanceIntervention,
  type MaintenancePlan,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { pageOffset, type PageParams } from "@/server/pagination";
import type { ContractListFilter, ContractSortKey } from "./contract.schema";
import type {
  ContractEventRow,
  ContractListRow,
  ContractSiteRow,
  ContractTicketRow,
  InterventionRow,
  MaintenancePlanRow,
  PriceReviewRow,
  RenewalRow,
  SiteOption,
} from "./contract.types";

/**
 * Requêtes des contrats. Les tables d'autres domaines (clients, sites, demandes, coûts) ne sont lues
 * que pour afficher un libellé ou compter : aucune écriture hors des tables du domaine 08.
 */
const STATUS_GROUPS: Record<ContractListFilter, readonly ContractStatus[] | null> = {
  all: null,
  open: ["to_start", "active", "to_review", "suspended"],
  active: ["active"],
  to_review: ["to_review"],
  to_start: ["to_start"],
  suspended: ["suspended"],
  ended: ["terminated", "expired"],
};

/** États dans lesquels le contrat est en vigueur et facturé. */
export const IN_FORCE_STATUSES: readonly ContractStatus[] = ["active", "to_review"];

const nextDueExpr = sql<string | null>`coalesce(${contracts.renewsOn}, ${contracts.endOn})`;

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identifiant illisible désigne un objet inexistant : la base n'a pas à le voir. */
export function isUuid(value: string): boolean {
  return UUID_FORMAT.test(value);
}

/**
 * Un site est rattaché à un contrat de deux façons : `contract_sites`, posé depuis la fiche du contrat,
 * ou `sites.contract_id`, posé depuis la fiche du site. Toute lecture des rattachements tient compte
 * des deux.
 */
function contractIdsOfSite(siteId: string): SQL {
  return sql`(
    select cs.contract_id from ${contractSites} cs where cs.site_id = ${siteId}::uuid
    union
    select s.contract_id from ${sites} s where s.id = ${siteId}::uuid and s.contract_id is not null
  )`;
}

function siteIdsOfContract(contractId: string): SQL {
  return sql`(
    select cs.site_id from ${contractSites} cs where cs.contract_id = ${contractId}::uuid
    union
    select s.id from ${sites} s where s.contract_id = ${contractId}::uuid
  )`;
}

/**
 * Noms qualifiés écrits en toutes lettres : sans jointure, Drizzle retire le nom de table des colonnes
 * d'une sélection, et `"status"` ou `"id"` deviendraient ambigus dans la sous-requête.
 */
const awaitsGoLiveExpr = sql<boolean>`("contracts"."status" = 'to_start' and exists (
  select 1 from "sites"
  where "sites"."status" in ('planned', 'staging')
    and "sites"."archived_at" is null
    and (
      "sites"."contract_id" = "contracts"."id"
      or exists (
        select 1 from "contract_sites"
        where "contract_sites"."contract_id" = "contracts"."id"
          and "contract_sites"."site_id" = "sites"."id"
      )
    )
))`;

const listColumns = {
  id: contracts.id,
  number: contracts.number,
  name: contracts.name,
  kind: contracts.kind,
  status: contracts.status,
  companyId: contracts.companyId,
  companyName: companies.name,
  planName: maintenancePlans.name,
  priceCents: contracts.priceCents,
  period: contracts.period,
  startOn: contracts.startOn,
  renewsOn: contracts.renewsOn,
  endOn: contracts.endOn,
  autoRenew: contracts.autoRenew,
  nextDueOn: nextDueExpr,
  awaitsGoLive: awaitsGoLiveExpr,
};

function listFilters(filters: {
  filter: ContractListFilter;
  kind: ContractKind | null;
  search: string;
}): SQL | undefined {
  const group = STATUS_GROUPS[filters.filter];
  const search = filters.search.replace(/[%_\\]/g, "\\$&");
  return and(
    isNull(contracts.archivedAt),
    group ? inArray(contracts.status, [...group]) : undefined,
    filters.kind ? eq(contracts.kind, filters.kind) : undefined,
    search
      ? or(
          ilike(contracts.name, `%${search}%`),
          ilike(contracts.number, `%${search}%`),
          ilike(companies.name, `%${search}%`),
        )
      : undefined,
  );
}

export async function listContractsPage(
  db: Database,
  filters: {
    filter: ContractListFilter;
    kind: ContractKind | null;
    search: string;
    sort: ContractSortKey;
    direction: "asc" | "desc";
  },
  params: PageParams,
): Promise<{ items: ContractListRow[]; total: number }> {
  const where = listFilters(filters);
  const direction = filters.direction === "desc" ? sql`desc` : sql`asc`;
  const orderBy: SQL[] = {
    contract: [sql`${companies.name} ${direction}`],
    price: [sql`${contracts.priceCents} ${direction}`],
    deadline: [sql`${nextDueExpr} ${direction} nulls last`],
  }[filters.sort];

  const [items, totals] = await Promise.all([
    db
      .select(listColumns)
      .from(contracts)
      .innerJoin(companies, eq(companies.id, contracts.companyId))
      .leftJoin(maintenancePlans, eq(maintenancePlans.id, contracts.planId))
      .where(where)
      .orderBy(...orderBy, asc(contracts.number))
      .limit(params.pageSize)
      .offset(pageOffset(params)),
    db
      .select({ total: count() })
      .from(contracts)
      .innerJoin(companies, eq(companies.id, contracts.companyId))
      .where(where),
  ]);
  return { items, total: totals[0]?.total ?? 0 };
}

export async function listCompanyContracts(
  db: Database,
  companyId: string,
  limit: number,
): Promise<
  (ContractListRow & { includedMinutes: number | null; includedTickets: number | null })[]
> {
  if (!isUuid(companyId)) return [];
  return db
    .select({
      ...listColumns,
      includedMinutes: contracts.includedMinutes,
      includedTickets: contracts.includedTickets,
    })
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .leftJoin(maintenancePlans, eq(maintenancePlans.id, contracts.planId))
    .where(and(eq(contracts.companyId, companyId), isNull(contracts.archivedAt)))
    .orderBy(asc(contracts.status), sql`${nextDueExpr} asc nulls last`, asc(contracts.number))
    .limit(limit);
}

/** Contrats rattachés à un site, le plus actif d'abord. */
export async function listSiteContracts(db: Database, siteId: string): Promise<ContractListRow[]> {
  if (!isUuid(siteId)) return [];
  return db
    .select(listColumns)
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .leftJoin(maintenancePlans, eq(maintenancePlans.id, contracts.planId))
    .where(and(sql`${contracts.id} in ${contractIdsOfSite(siteId)}`, isNull(contracts.archivedAt)))
    .orderBy(asc(contracts.number));
}

export async function findContract(db: Database, id: string): Promise<Contract | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, id), isNull(contracts.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Verrouille la ligne jusqu'à la fin de la transaction : les écritures d'un contrat s'attendent. */
export async function lockContract(tx: Database, id: string): Promise<Contract | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, id), isNull(contracts.archivedAt)))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function findContractLabels(
  db: Database,
  contract: Pick<Contract, "companyId" | "planId" | "quoteId">,
): Promise<{ companyName: string; planName: string | null; quoteNumber: string | null }> {
  const [company, plan, quote] = await Promise.all([
    db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, contract.companyId))
      .limit(1),
    contract.planId
      ? db
          .select({ name: maintenancePlans.name })
          .from(maintenancePlans)
          .where(eq(maintenancePlans.id, contract.planId))
          .limit(1)
      : Promise.resolve([]),
    contract.quoteId
      ? db
          .select({ number: quotes.number })
          .from(quotes)
          .where(eq(quotes.id, contract.quoteId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    companyName: company[0]?.name ?? "",
    planName: plan[0]?.name ?? null,
    quoteNumber: quote[0]?.number ?? null,
  };
}

export async function contractAwaitsGoLive(db: Database, id: string): Promise<boolean> {
  const [row] = await db
    .select({ waiting: awaitsGoLiveExpr })
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);
  return row?.waiting ?? false;
}

/**
 * Vrai si le client existe. Verrouille sa ligne jusqu'à la fin de la transaction : deux créations
 * simultanées pour un même client s'attendent, et la garde contre le doublon de nom voit la première.
 */
export async function lockCompanyForContract(tx: Database, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, id), isNull(companies.archivedAt)))
    .limit(1)
    .for("no key update");
  return Boolean(row);
}

/** Vrai si un contrat en cours de ce client porte déjà ce nom : garde contre un double envoi. */
export async function openContractNamed(
  db: Database,
  companyId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.companyId, companyId),
        sql`lower(${contracts.name}) = lower(${name})`,
        isNull(contracts.archivedAt),
        notInArray(contracts.status, ["terminated", "expired"]),
        exceptId ? ne(contracts.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function quoteBelongsToCompany(
  db: Database,
  quoteId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.companyId, companyId)))
    .limit(1);
  return Boolean(row);
}

export async function insertContract(
  tx: Database,
  values: typeof contracts.$inferInsert,
): Promise<Contract> {
  const [row] = await tx.insert(contracts).values(values).returning();
  if (!row) throw new Error("Contrat non créé.");
  return row;
}

export async function updateContract(
  tx: Database,
  id: string,
  values: Partial<typeof contracts.$inferInsert>,
): Promise<Contract> {
  const [row] = await tx.update(contracts).set(values).where(eq(contracts.id, id)).returning();
  if (!row) throw new Error("Contrat non modifié.");
  return row;
}

// --- Historique --------------------------------------------------------------------------------

export async function insertEvent(
  tx: Database,
  values: typeof contractEvents.$inferInsert,
): Promise<void> {
  await tx.insert(contractEvents).values(values);
}

export async function listEvents(
  db: Database,
  contractId: string,
  limit: number,
): Promise<ContractEventRow[]> {
  return db
    .select({
      id: contractEvents.id,
      kind: contractEvents.kind,
      fromPriceCents: contractEvents.fromPriceCents,
      toPriceCents: contractEvents.toPriceCents,
      note: contractEvents.note,
      actorName: users.name,
      at: contractEvents.at,
    })
    .from(contractEvents)
    .leftJoin(users, eq(users.id, contractEvents.actorId))
    .where(eq(contractEvents.contractId, contractId))
    .orderBy(desc(contractEvents.at), desc(contractEvents.createdAt))
    .limit(limit);
}

// --- Sites -------------------------------------------------------------------------------------

export async function listLinkedSites(
  db: Database,
  contractId: string,
): Promise<ContractSiteRow[]> {
  const rows = await db
    .select({
      siteId: sites.id,
      name: sites.name,
      primaryDomain: sites.primaryDomain,
      status: sites.status,
      hostingLabel: sites.hostingLabel,
      serverLabel: sites.serverLabel,
      siteContractId: sites.contractId,
    })
    .from(sites)
    .where(and(isNull(sites.archivedAt), sql`${sites.id} in ${siteIdsOfContract(contractId)}`))
    .orderBy(asc(sites.name));
  return rows.map(({ siteContractId, ...row }) => ({
    ...row,
    removable: siteContractId !== contractId,
  }));
}

/** Tous les sites vivants d'un client : ce que couvre un contrat sans site rattaché. */
export async function listCompanySites(
  db: Database,
  companyId: string,
): Promise<ContractSiteRow[]> {
  const rows = await db
    .select({
      siteId: sites.id,
      name: sites.name,
      primaryDomain: sites.primaryDomain,
      status: sites.status,
      hostingLabel: sites.hostingLabel,
      serverLabel: sites.serverLabel,
    })
    .from(sites)
    .where(and(eq(sites.companyId, companyId), isNull(sites.archivedAt)))
    .orderBy(asc(sites.name))
    .limit(100);
  return rows.map((row) => ({ ...row, removable: false }));
}

/** Noms de domaine portés par ces sites, le plus proche de son expiration d'abord. */
export async function listDomainsOfSites(
  db: Database,
  siteIds: readonly string[],
): Promise<{ name: string; expiresOn: string | null; autoRenew: boolean }[]> {
  if (siteIds.length === 0) return [];
  return db
    .select({ name: domains.name, expiresOn: domains.expiresOn, autoRenew: domains.autoRenew })
    .from(domains)
    .where(and(inArray(domains.siteId, [...siteIds]), isNull(domains.archivedAt)))
    .orderBy(sql`${domains.expiresOn} asc nulls last`, asc(domains.name))
    .limit(100);
}

/** Le contrat que porte la fiche du site, s'il y en a un. */
export async function findSiteContractId(db: Database, siteId: string): Promise<string | null> {
  const [row] = await db
    .select({ contractId: sites.contractId })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  return row?.contractId ?? null;
}

export async function findCompanySite(
  db: Database,
  siteId: string,
  companyId: string,
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: sites.name })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.companyId, companyId), isNull(sites.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function listCompanySiteOptions(
  db: Database,
  companyId: string,
): Promise<SiteOption[]> {
  return db
    .select({ id: sites.id, name: sites.name, primaryDomain: sites.primaryDomain })
    .from(sites)
    .where(and(eq(sites.companyId, companyId), isNull(sites.archivedAt)))
    .orderBy(asc(sites.name))
    .limit(500);
}

/** Vrai à la création de la ligne, faux si le site était déjà rattaché. */
export async function linkSite(
  tx: Database,
  values: { contractId: string; siteId: string; companyId: string },
): Promise<boolean> {
  const rows = await tx
    .insert(contractSites)
    .values(values)
    .onConflictDoNothing({ target: [contractSites.contractId, contractSites.siteId] })
    .returning({ id: contractSites.id });
  return rows.length > 0;
}

export async function unlinkSite(
  tx: Database,
  contractId: string,
  siteId: string,
): Promise<boolean> {
  const rows = await tx
    .delete(contractSites)
    .where(and(eq(contractSites.contractId, contractId), eq(contractSites.siteId, siteId)))
    .returning({ id: contractSites.id });
  return rows.length > 0;
}

/** Sites rattachés, contrat par contrat, pour les contrats d'un client. */
export async function listSiteLinksForContracts(
  db: Database,
  contractIds: readonly string[],
): Promise<{ contractId: string; siteId: string }[]> {
  if (contractIds.length === 0) return [];
  const ids = [...contractIds];
  const fromContracts = await db
    .select({ contractId: contractSites.contractId, siteId: contractSites.siteId })
    .from(contractSites)
    .where(inArray(contractSites.contractId, ids));
  const fromSites = await db
    .select({ contractId: sites.contractId, siteId: sites.id })
    .from(sites)
    .where(inArray(sites.contractId, ids));
  const links = new Map<string, { contractId: string; siteId: string }>();
  for (const { contractId, siteId } of [...fromContracts, ...fromSites]) {
    if (contractId) links.set(`${contractId}:${siteId}`, { contractId, siteId });
  }
  return [...links.values()];
}

export async function listCompanyCoverageCandidates(
  db: Database,
  companyId: string,
): Promise<Contract[]> {
  return db
    .select()
    .from(contracts)
    .where(and(eq(contracts.companyId, companyId), isNull(contracts.archivedAt)))
    .orderBy(asc(contracts.number));
}

// --- Consommation ------------------------------------------------------------------------------

export interface ConsumptionWindow {
  contractId: string;
  start: string;
  end: string;
}

/**
 * Consommation réalisée par contrat, chacun sur sa propre période. Source unique : les interventions
 * réalisées. Une intervention prévue, même chiffrée, ne consomme rien.
 */
export async function sumConsumption(
  db: Database,
  windows: readonly ConsumptionWindow[],
): Promise<Map<string, { minutes: number; tickets: number }>> {
  const result = new Map<string, { minutes: number; tickets: number }>();
  if (windows.length === 0) return result;

  const values = sql.join(
    windows.map(
      (window) => sql`(${window.contractId}::uuid, ${window.start}::date, ${window.end}::date)`,
    ),
    sql`, `,
  );
  const rows = await db
    .select({
      contractId: maintenanceInterventions.contractId,
      minutes: sql<string>`coalesce(sum(${maintenanceInterventions.minutes}), 0)`,
      tickets: sql<string>`count(distinct ${maintenanceInterventions.ticketId})`,
    })
    .from(maintenanceInterventions)
    .innerJoin(
      sql`(values ${values}) as w(contract_id, start_on, end_on)`,
      sql`${maintenanceInterventions.contractId} = w.contract_id
        and ${maintenanceInterventions.doneOn} >= w.start_on
        and ${maintenanceInterventions.doneOn} <= w.end_on`,
    )
    .groupBy(maintenanceInterventions.contractId);
  for (const row of rows) {
    result.set(row.contractId, { minutes: Number(row.minutes), tickets: Number(row.tickets) });
  }
  return result;
}

export interface QuotaContract {
  id: string;
  name: string;
  companyName: string;
  kind: ContractKind;
  period: Contract["period"];
  startOn: string | null;
  includedMinutes: number | null;
  includedTickets: number | null;
}

/** Contrats en vigueur qui prévoient un quota non nul : base de « Forfaits consommés ». */
export async function listQuotaContracts(db: Database): Promise<QuotaContract[]> {
  return db
    .select({
      id: contracts.id,
      name: contracts.name,
      companyName: companies.name,
      kind: contracts.kind,
      period: contracts.period,
      startOn: contracts.startOn,
      includedMinutes: contracts.includedMinutes,
      includedTickets: contracts.includedTickets,
    })
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .where(
      and(
        isNull(contracts.archivedAt),
        inArray(contracts.status, [...IN_FORCE_STATUSES]),
        or(gt(contracts.includedMinutes, 0), gt(contracts.includedTickets, 0)),
      ),
    );
}

// --- Revenus récurrents ------------------------------------------------------------------------

export interface BillingCandidate {
  id: string;
  kind: ContractKind;
  status: ContractStatus;
  priceCents: number;
  period: Contract["period"];
  startOn: string | null;
  endOn: string | null;
  terminatedAt: Date | null;
}

export async function listBillingCandidates(
  db: Database,
  onDay: string,
): Promise<BillingCandidate[]> {
  return db
    .select({
      id: contracts.id,
      kind: contracts.kind,
      status: contracts.status,
      priceCents: contracts.priceCents,
      period: contracts.period,
      startOn: contracts.startOn,
      endOn: contracts.endOn,
      terminatedAt: contracts.terminatedAt,
    })
    .from(contracts)
    .where(
      and(
        isNull(contracts.archivedAt),
        ne(contracts.status, "to_start"),
        or(isNull(contracts.startOn), lte(contracts.startOn, onDay)),
      ),
    );
}

/** Changements de prix postérieurs à `at`, les plus anciens d'abord : le prix d'alors est le `from`. */
export async function listPriceChangesAfter(
  db: Database,
  at: Date,
): Promise<{ contractId: string; fromPriceCents: number | null }[]> {
  return db
    .select({
      contractId: contractEvents.contractId,
      fromPriceCents: contractEvents.fromPriceCents,
    })
    .from(contractEvents)
    .where(and(eq(contractEvents.kind, "price_change"), gt(contractEvents.at, at)))
    .orderBy(asc(contractEvents.at));
}

export async function listLastSuspensions(
  db: Database,
  contractIds: readonly string[],
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (contractIds.length === 0) return result;
  const rows = await db
    .select({
      contractId: contractEvents.contractId,
      at: sql<Date>`max(${contractEvents.at})`.mapWith(contractEvents.at),
    })
    .from(contractEvents)
    .where(
      and(
        eq(contractEvents.kind, "suspended"),
        inArray(contractEvents.contractId, [...contractIds]),
      ),
    )
    .groupBy(contractEvents.contractId);
  for (const row of rows) result.set(row.contractId, row.at);
  return result;
}

// --- Échéances et révisions --------------------------------------------------------------------

/** Contrats en vigueur dont l'échéance tombe au plus tard `until`, retards compris. */
export async function listDueContracts(
  db: Database,
  until: string,
  limit?: number,
): Promise<RenewalRow[]> {
  const query = db
    .select({
      contractId: contracts.id,
      companyName: companies.name,
      contractName: contracts.name,
      kind: contracts.kind,
      status: contracts.status,
      dueOn: sql<string>`${nextDueExpr}`,
      autoRenew: contracts.autoRenew,
      conditions: contracts.conditions,
    })
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .where(
      and(
        isNull(contracts.archivedAt),
        inArray(contracts.status, [...IN_FORCE_STATUSES]),
        isNotNull(nextDueExpr),
        sql`${nextDueExpr} <= ${until}::date`,
      ),
    )
    .orderBy(sql`${nextDueExpr} asc`, asc(contracts.number));
  return limit === undefined ? query : query.limit(limit);
}

export async function countByStatus(db: Database): Promise<Map<ContractStatus, number>> {
  const rows = await db
    .select({ status: contracts.status, total: count() })
    .from(contracts)
    .where(isNull(contracts.archivedAt))
    .groupBy(contracts.status);
  return new Map(rows.map((row) => [row.status, row.total]));
}

/** Contrat en vigueur et date de son dernier changement de prix, base de la révision de tarif. */
export async function listPriceReviewBases(
  db: Database,
): Promise<
  (Omit<PriceReviewRow, "reviewOn"> & { startOn: string | null; lastChange: Date | null })[]
> {
  return db
    .select({
      contractId: contracts.id,
      companyName: companies.name,
      kind: contracts.kind,
      priceCents: contracts.priceCents,
      period: contracts.period,
      status: contracts.status,
      startOn: contracts.startOn,
      lastChange: sql<Date | null>`(
        select max(e.at) from ${contractEvents} e
        where e.contract_id = ${contracts.id} and e.kind = 'price_change'
      )`.mapWith((value: string | Date | null) => (value ? new Date(value) : null)),
    })
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .where(and(isNull(contracts.archivedAt), inArray(contracts.status, [...IN_FORCE_STATUSES])));
}

/** Contrats à traiter par la tâche planifiée : ceux dont une date est atteinte ou proche. */
export async function listContractsForSweep(db: Database, until: string): Promise<Contract[]> {
  return db
    .select()
    .from(contracts)
    .where(
      and(
        isNull(contracts.archivedAt),
        inArray(contracts.status, [...IN_FORCE_STATUSES]),
        or(lte(contracts.renewsOn, until), lte(contracts.endOn, until)),
      ),
    )
    .orderBy(asc(contracts.number));
}

export async function listToStartContractsForSite(
  tx: Database,
  siteId: string,
): Promise<Contract[]> {
  return tx
    .select()
    .from(contracts)
    .where(
      and(
        sql`${contracts.id} in ${contractIdsOfSite(siteId)}`,
        eq(contracts.status, "to_start"),
        isNull(contracts.archivedAt),
      ),
    )
    .for("update");
}

/** Demande de changement encore vivante de ce client, reconnue à son titre : la reprise d'un envoi. */
export async function findLiveChangeRequestByTitle(
  db: Database,
  companyId: string,
  title: string,
): Promise<{ id: string; quoteId: string | null } | null> {
  const [row] = await db
    .select({ id: changeRequests.id, quoteId: changeRequests.quoteId })
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.companyId, companyId),
        sql`lower(${changeRequests.title}) = lower(${title})`,
        ne(changeRequests.status, "refused"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Demandes rattachées au contrat, ouvertes d'abord, puis les plus récentes. */
export async function listContractTickets(
  db: Database,
  contractId: string,
  limit: number,
): Promise<{ items: ContractTicketRow[]; total: number }> {
  const where = and(eq(tickets.contractId, contractId), isNull(tickets.archivedAt));
  const items = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      coverage: tickets.coverage,
    })
    .from(tickets)
    .where(where)
    .orderBy(
      sql`${tickets.status} in ('resolved', 'closed')`,
      desc(tickets.createdAt),
      desc(tickets.number),
    )
    .limit(limit);
  const [totals] = await db.select({ total: count() }).from(tickets).where(where);
  return { items, total: totals?.total ?? 0 };
}

// --- Résiliation -------------------------------------------------------------------------------

export async function countOpenTickets(db: Database, contractId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(tickets)
    .where(
      and(
        eq(tickets.contractId, contractId),
        isNull(tickets.archivedAt),
        notInArray(tickets.status, ["resolved", "closed"]),
      ),
    );
  return row?.total ?? 0;
}

/** Coûts récurrents du contrat, et ceux portés par les sites qu'il couvre. */
export async function listRecurringCosts(
  db: Database,
  contractId: string,
  siteIds: readonly string[] = [],
): Promise<{ label: string; amountCents: number; period: string | null }[]> {
  return db
    .select({
      label: directCosts.label,
      amountCents: directCosts.amountCents,
      period: directCosts.recurringPeriod,
    })
    .from(directCosts)
    .where(
      and(
        or(
          eq(directCosts.contractId, contractId),
          siteIds.length > 0 ? inArray(directCosts.siteId, [...siteIds]) : undefined,
        ),
        isNotNull(directCosts.recurringPeriod),
        isNull(directCosts.archivedAt),
      ),
    )
    .orderBy(asc(directCosts.label))
    .limit(50);
}

export async function countPlannedScheduleItems(db: Database, contractId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(paymentScheduleItems)
    .where(
      and(
        eq(paymentScheduleItems.contractId, contractId),
        eq(paymentScheduleItems.status, "planned"),
        isNull(paymentScheduleItems.archivedAt),
      ),
    );
  return row?.total ?? 0;
}

// --- Interventions -----------------------------------------------------------------------------

/** Note posée sur une intervention prévue quand le contrat est résilié. */
export const CANCELLED_INTERVENTION_RESULT = "Annulée : contrat résilié.";

function toInterventionRow(row: Omit<InterventionRow, "cancelled">): InterventionRow {
  return {
    ...row,
    cancelled: row.doneOn === null && row.result === CANCELLED_INTERVENTION_RESULT,
  };
}

const interventionColumns = {
  id: maintenanceInterventions.id,
  contractId: maintenanceInterventions.contractId,
  companyName: companies.name,
  title: maintenanceInterventions.title,
  siteId: maintenanceInterventions.siteId,
  siteName: sites.name,
  ticketId: maintenanceInterventions.ticketId,
  ticketNumber: tickets.number,
  memberId: maintenanceInterventions.memberId,
  memberName: teamMembers.fullName,
  plannedOn: maintenanceInterventions.plannedOn,
  doneOn: maintenanceInterventions.doneOn,
  result: maintenanceInterventions.result,
  minutes: maintenanceInterventions.minutes,
};

function interventionsQuery(db: Database) {
  return db
    .select(interventionColumns)
    .from(maintenanceInterventions)
    .innerJoin(companies, eq(companies.id, maintenanceInterventions.companyId))
    .leftJoin(sites, eq(sites.id, maintenanceInterventions.siteId))
    .leftJoin(tickets, eq(tickets.id, maintenanceInterventions.ticketId))
    .leftJoin(teamMembers, eq(teamMembers.id, maintenanceInterventions.memberId));
}

export async function listContractInterventions(
  db: Database,
  contractId: string,
  params: PageParams,
): Promise<{ items: InterventionRow[]; total: number }> {
  const where = eq(maintenanceInterventions.contractId, contractId);
  const [items, totals] = await Promise.all([
    interventionsQuery(db)
      .where(where)
      // Prévues d'abord, puis réalisées de la plus récente à la plus ancienne.
      .orderBy(
        sql`${maintenanceInterventions.doneOn} is not null`,
        sql`${maintenanceInterventions.plannedOn} asc nulls last`,
        desc(maintenanceInterventions.doneOn),
        desc(maintenanceInterventions.createdAt),
      )
      .limit(params.pageSize)
      .offset(pageOffset(params)),
    db.select({ total: count() }).from(maintenanceInterventions).where(where),
  ]);
  return { items: items.map(toInterventionRow), total: totals[0]?.total ?? 0 };
}

export async function listRecentInterventions(
  db: Database,
  limit: number,
): Promise<InterventionRow[]> {
  const rows = await interventionsQuery(db)
    .innerJoin(contracts, eq(contracts.id, maintenanceInterventions.contractId))
    .where(and(isNotNull(maintenanceInterventions.doneOn), isNull(contracts.archivedAt)))
    .orderBy(desc(maintenanceInterventions.doneOn), desc(maintenanceInterventions.createdAt))
    .limit(limit);
  return rows.map(toInterventionRow);
}

export async function findIntervention(
  db: Database,
  id: string,
  contractId: string,
): Promise<MaintenanceIntervention | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(maintenanceInterventions)
    .where(
      and(eq(maintenanceInterventions.id, id), eq(maintenanceInterventions.contractId, contractId)),
    )
    .limit(1);
  return row ?? null;
}

/** Intervention identique déjà inscrite : le rejeu d'un envoi, à ne pas compter deux fois. */
export async function findSameIntervention(
  tx: Database,
  values: {
    contractId: string;
    title: string;
    siteId: string | null;
    plannedOn: string | null;
    doneOn: string | null;
    minutes: number | null;
  },
): Promise<MaintenanceIntervention | null> {
  const [row] = await tx
    .select()
    .from(maintenanceInterventions)
    .where(
      and(
        eq(maintenanceInterventions.contractId, values.contractId),
        eq(maintenanceInterventions.title, values.title),
        isNull(maintenanceInterventions.ticketId),
        sql`${maintenanceInterventions.siteId} is not distinct from ${values.siteId}::uuid`,
        sql`${maintenanceInterventions.plannedOn} is not distinct from ${values.plannedOn}::date`,
        sql`${maintenanceInterventions.doneOn} is not distinct from ${values.doneOn}::date`,
        sql`${maintenanceInterventions.minutes} is not distinct from ${values.minutes}::integer`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertIntervention(
  tx: Database,
  values: typeof maintenanceInterventions.$inferInsert,
): Promise<MaintenanceIntervention> {
  const [row] = await tx.insert(maintenanceInterventions).values(values).returning();
  if (!row) throw new Error("Intervention non créée.");
  return row;
}

export async function updateIntervention(
  tx: Database,
  id: string,
  values: Partial<typeof maintenanceInterventions.$inferInsert>,
): Promise<MaintenanceIntervention> {
  const [row] = await tx
    .update(maintenanceInterventions)
    .set(values)
    .where(eq(maintenanceInterventions.id, id))
    .returning();
  if (!row) throw new Error("Intervention non modifiée.");
  return row;
}

/** Interventions prévues et non réalisées, sans les annulées. */
export async function countPlannedInterventions(db: Database, contractId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(maintenanceInterventions)
    .where(
      and(
        eq(maintenanceInterventions.contractId, contractId),
        isNull(maintenanceInterventions.doneOn),
        isNull(maintenanceInterventions.result),
      ),
    );
  return row?.total ?? 0;
}

export async function cancelPlannedInterventions(tx: Database, contractId: string): Promise<void> {
  await tx
    .update(maintenanceInterventions)
    .set({ result: CANCELLED_INTERVENTION_RESULT })
    .where(
      and(
        eq(maintenanceInterventions.contractId, contractId),
        isNull(maintenanceInterventions.doneOn),
        isNull(maintenanceInterventions.result),
      ),
    );
}

/**
 * Ligne de consommation d'un ticket sur une période : réalisée dans la période, ou encore prévue
 * (parcours 3 : l'intervention ouverte depuis le ticket se réalise au lieu d'être dupliquée).
 */
export async function findTicketIntervention(
  tx: Database,
  input: { contractId: string; ticketId: string; start: string; end: string },
): Promise<MaintenanceIntervention | null> {
  const [row] = await tx
    .select()
    .from(maintenanceInterventions)
    .where(
      and(
        eq(maintenanceInterventions.contractId, input.contractId),
        eq(maintenanceInterventions.ticketId, input.ticketId),
        or(
          isNull(maintenanceInterventions.doneOn),
          and(
            gte(maintenanceInterventions.doneOn, input.start),
            lte(maintenanceInterventions.doneOn, input.end),
          ),
        ),
      ),
    )
    .orderBy(sql`${maintenanceInterventions.doneOn} is null`)
    .limit(1);
  return row ?? null;
}

export async function findTicketLabel(
  db: Database,
  ticketId: string,
  companyId: string,
): Promise<{ number: string; subject: string; siteId: string | null } | null> {
  const [row] = await db
    .select({ number: tickets.number, subject: tickets.subject, siteId: tickets.siteId })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

export async function memberExists(db: Database, memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.id, memberId),
        eq(teamMembers.status, "active"),
        isNull(teamMembers.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// --- Formules ----------------------------------------------------------------------------------

export async function listPlans(
  db: Database,
  options: { activeOnly: boolean },
): Promise<MaintenancePlanRow[]> {
  return db
    .select({
      id: maintenancePlans.id,
      name: maintenancePlans.name,
      description: maintenancePlans.description,
      priceCents: maintenancePlans.priceCents,
      period: maintenancePlans.period,
      includedMinutes: maintenancePlans.includedMinutes,
      includedTickets: maintenancePlans.includedTickets,
      scope: maintenancePlans.scope,
      exclusions: maintenancePlans.exclusions,
      responseHours: maintenancePlans.responseHours,
      resolutionHours: maintenancePlans.resolutionHours,
      active: maintenancePlans.active,
      // Nom qualifié en toutes lettres : sans jointure, Drizzle écrirait `"id"`, lu comme `c.id`.
      contractCount: sql<number>`(
        select count(*) from ${contracts} c
        where c.plan_id = "maintenance_plans"."id"
          and c.archived_at is null
          and c.status not in ('terminated', 'expired')
      )`.mapWith(Number),
    })
    .from(maintenancePlans)
    .where(options.activeOnly ? eq(maintenancePlans.active, true) : undefined)
    .orderBy(desc(maintenancePlans.active), asc(maintenancePlans.name));
}

export async function findPlan(db: Database, id: string): Promise<MaintenancePlan | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(maintenancePlans)
    .where(eq(maintenancePlans.id, id))
    .limit(1);
  return row ?? null;
}

export async function planNamed(db: Database, name: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: maintenancePlans.id })
    .from(maintenancePlans)
    .where(
      and(
        sql`lower(${maintenancePlans.name}) = lower(${name})`,
        exceptId ? ne(maintenancePlans.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function insertPlan(
  tx: Database,
  values: typeof maintenancePlans.$inferInsert,
): Promise<MaintenancePlan> {
  const [row] = await tx.insert(maintenancePlans).values(values).returning();
  if (!row) throw new Error("Formule non créée.");
  return row;
}

export async function updatePlan(
  tx: Database,
  id: string,
  values: Partial<typeof maintenancePlans.$inferInsert>,
): Promise<MaintenancePlan> {
  const [row] = await tx
    .update(maintenancePlans)
    .set(values)
    .where(eq(maintenancePlans.id, id))
    .returning();
  if (!row) throw new Error("Formule non modifiée.");
  return row;
}
