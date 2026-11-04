import { COST_CATEGORY_LABELS } from "@/lib/domain-enums";
import { formatMinutes } from "@/lib/format";
import { formatCents, marginPercent } from "@/lib/money";
import { getTimeTotals } from "@/modules/time/time.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { NotFoundError } from "@/server/errors";
import type { PageParams, Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { countOccurrences, parisDay } from "./finance.dates";
import { marginIdSchema, marginInputSchema, marginScopeSchema } from "./finance.schema";
import * as repository from "./profitability.repository";
import type {
  ContractTarget,
  CostRow,
  DocumentGroup,
  ProjectTarget,
  QuoteFigures,
} from "./profitability.repository";

export type MarginScope = "project" | "client" | "site" | "contract";

/** Bornes incluses, dates `AAAA-MM-JJ`. */
export interface MarginPeriod {
  from: string;
  to: string;
}

export interface GetMarginInput {
  scope: MarginScope;
  id: string;
  /** Absente : toute la vie de l'objet. */
  period?: MarginPeriod;
}

export type MarginLineKind =
  | "invoice"
  | "credit_note"
  | "quote"
  | "budget"
  | "contract_price"
  | "schedule"
  | "time"
  | "time_estimate"
  | "direct_cost"
  | "contract_cost";

/** Une ligne de ce qui est compté : le calcul se lit, rien n'est implicite. */
export interface MarginLine {
  key: string;
  kind: MarginLineKind;
  /** `revenue` ou `cost` : le signe de la ligne dans le calcul. */
  side: "revenue" | "cost";
  label: string;
  amountCents: number;
  detail?: string;
}

/** Une colonne du calcul. Montants HT en centimes. */
export interface MarginFigures {
  /** NULL : revenu inconnu (aucune facture référencée, aucun devis), jamais 0. */
  revenueCents: number | null;
  /** `minutes × hourly_cost_cents` figé à la saisie ; au prévisionnel, le coût estimé du devis. */
  timeCostCents: number;
  minutes: number;
  directCostCents: number;
  totalCostCents: number;
  /** `revenueCents − totalCostCents`. NULL sans revenu connu. */
  marginCents: number | null;
  /** NULL sans revenu : non calculable, jamais 0. */
  marginPercent: number | null;
  lines: MarginLine[];
  /** Pourquoi une valeur manque ou reste partielle, en français, affichable tel quel. */
  unavailable: string[];
}

/** Prévisionnel et réalisé restent séparés : ils ne s'additionnent jamais. */
export interface MarginBreakdown {
  scope: MarginScope;
  id: string;
  /** Nom de l'objet, pour l'écran de détail. */
  label: string;
  companyId: string;
  period: MarginPeriod | null;
  forecast: MarginFigures;
  actual: MarginFigures;
}

interface ContractShare {
  contract: ContractTarget;
  /** Part de ce contrat attribuée à la cible : un contrat réparti sur N sites compte 1/N par site. */
  share: number;
}

interface Target {
  scope: MarginScope;
  id: string;
  label: string;
  companyId: string;
  projects: ProjectTarget[];
  contracts: ContractShare[];
}

function isSameObject(
  target: Target,
  row: { projectId: string | null; contractId: string | null },
) {
  if (row.projectId && target.projects.some((project) => project.id === row.projectId)) return 1;
  const match = target.contracts.find((item) => item.contract.id === row.contractId);
  return match?.share ?? 0;
}

function documentShare(target: Target, row: DocumentGroup): number {
  if (target.scope === "client") return row.companyId === target.id ? 1 : 0;
  if (target.scope === "project") return row.projectId === target.id ? 1 : 0;
  if (target.scope === "contract") return row.contractId === target.id ? 1 : 0;
  return isSameObject(target, row);
}

function costShare(target: Target, row: CostRow): number {
  if (target.scope === "client") return row.companyId === target.id ? 1 : 0;
  if (target.scope === "project") return row.projectId === target.id ? 1 : 0;
  if (target.scope === "contract") return row.contractId === target.id ? 1 : 0;
  // Site : un coût posé sur un autre site ne se répartit pas sur celui-ci.
  if (row.siteId) return row.siteId === target.id ? 1 : 0;
  return isSameObject(target, row);
}

const scaled = (cents: number, share: number) => Math.round(cents * share);

/** Montant d'un coût sur la période : une récurrence compte autant de fois qu'elle est tombée. */
function costAmount(row: CostRow, period: MarginPeriod | null, today: string): number {
  if (!row.recurringPeriod) {
    if (!period) return row.amountCents;
    return row.incurredOn >= period.from && row.incurredOn <= period.to ? row.amountCents : 0;
  }
  const to =
    row.nature === "actual"
      ? period && period.to < today
        ? period.to
        : today
      : (period?.to ?? today);
  const occurrences = countOccurrences(row.incurredOn, row.recurringPeriod, {
    from: period?.from,
    to,
  });
  // Un prévisionnel non encore commencé compte pour une échéance.
  const counted = row.nature === "forecast" && !period ? Math.max(1, occurrences) : occurrences;
  return row.amountCents * counted;
}

function finalize(
  draft: { revenueCents: number | null; lines: MarginLine[]; unavailable: string[] },
  time: { cents: number; minutes: number },
): MarginFigures {
  const directCostCents = draft.lines
    .filter((line) => line.kind === "direct_cost" || line.kind === "contract_cost")
    .reduce((total, line) => total + line.amountCents, 0);
  const totalCostCents = time.cents + directCostCents;
  return {
    revenueCents: draft.revenueCents,
    timeCostCents: time.cents,
    minutes: time.minutes,
    directCostCents,
    totalCostCents,
    marginCents: draft.revenueCents === null ? null : draft.revenueCents - totalCostCents,
    marginPercent:
      draft.revenueCents === null ? null : marginPercent(draft.revenueCents, totalCostCents),
    lines: draft.lines,
    unavailable: draft.unavailable,
  };
}

function directCostLines(
  target: Target,
  costs: readonly CostRow[],
  nature: "forecast" | "actual",
  period: MarginPeriod | null,
  today: string,
): { lines: MarginLine[]; unavailable: string[] } {
  const totals = new Map<string, { cents: number; count: number }>();
  const unavailable: string[] = [];
  for (const row of costs) {
    if (row.nature !== nature) continue;
    const share = costShare(target, row);
    if (share === 0) continue;
    if (row.amountCents === 0) {
      unavailable.push(`« ${row.label} » reste à chiffrer : non compté.`);
      continue;
    }
    const cents = scaled(costAmount(row, period, today), share);
    if (cents === 0) continue;
    const entry = totals.get(row.category) ?? { cents: 0, count: 0 };
    entry.cents += cents;
    entry.count += 1;
    totals.set(row.category, entry);
  }
  const lines = [...totals.entries()].map(([category, entry]) => ({
    key: `direct:${category}`,
    kind: "direct_cost" as const,
    side: "cost" as const,
    label: COST_CATEGORY_LABELS[category as keyof typeof COST_CATEGORY_LABELS],
    amountCents: entry.cents,
    detail: entry.count > 1 ? `${entry.count} coûts` : "1 coût",
  }));
  return { lines, unavailable };
}

function actualFigures(
  target: Target,
  documents: readonly DocumentGroup[],
  costs: readonly CostRow[],
  time: TimeCost,
  period: MarginPeriod | null,
  today: string,
): MarginFigures {
  let invoiceCents = 0;
  let invoiceCount = 0;
  let creditCents = 0;
  let creditCount = 0;
  let paidCents = 0;
  for (const row of documents) {
    const share = documentShare(target, row);
    if (share === 0) continue;
    const cents = scaled(row.cents, share);
    if (row.kind === "credit_note") {
      creditCents += cents;
      creditCount += row.documents;
    } else {
      invoiceCents += cents;
      invoiceCount += row.documents;
    }
    if (row.paid) paidCents += cents;
  }

  const lines: MarginLine[] = [];
  const unavailable: string[] = [];
  const known = invoiceCount + creditCount > 0;
  if (invoiceCount > 0) {
    lines.push({
      key: "invoices",
      kind: "invoice",
      side: "revenue",
      label: "Factures référencées",
      amountCents: invoiceCents,
      detail: `${invoiceCount} facture${invoiceCount > 1 ? "s" : ""} · ${formatCents(paidCents)} encaissés`,
    });
  }
  if (creditCount > 0) {
    lines.push({
      key: "credit_notes",
      kind: "credit_note",
      side: "revenue",
      label: "Avoirs",
      amountCents: creditCents,
      detail: `${creditCount} avoir${creditCount > 1 ? "s" : ""}`,
    });
  }
  if (!known) {
    unavailable.push(
      "Aucune facture référencée : revenu réel indisponible. Importez le fichier Indy ou saisissez la référence.",
    );
  }

  const direct = directCostLines(target, costs, "actual", period, today);
  lines.push(...direct.lines);
  unavailable.push(...direct.unavailable);
  if (time.minutes > 0) {
    lines.push({
      key: "time",
      kind: "time",
      side: "cost",
      label: "Temps passé",
      amountCents: time.cents,
      detail: `${formatMinutes(time.minutes)} au coût horaire figé à la saisie`,
    });
  }

  return finalize(
    { revenueCents: known ? invoiceCents + creditCents : null, lines, unavailable },
    time,
  );
}

function forecastFigures(
  target: Target,
  costs: readonly CostRow[],
  quotes: ReadonlyMap<string, QuoteFigures>,
  quotesWithProject: ReadonlySet<string>,
  scheduleByProject: ReadonlyMap<string, number>,
  period: MarginPeriod | null,
  today: string,
): MarginFigures {
  const lines: MarginLine[] = [];
  const unavailable: string[] = [];
  const seenQuotes = new Set<string>();
  let revenue = 0;
  let known = false;
  let estimatedCost = 0;
  let estimatedMinutes = 0;

  const addRevenue = (line: Omit<MarginLine, "side">) => {
    lines.push({ ...line, side: "revenue" });
    revenue += line.amountCents;
    known = true;
  };
  const addQuote = (quote: QuoteFigures, share: number) => {
    if (seenQuotes.has(quote.id)) return;
    seenQuotes.add(quote.id);
    addRevenue({
      key: `quote:${quote.id}`,
      kind: "quote",
      label: `Devis ${quote.number}`,
      amountCents: scaled(quote.totalCents, share),
    });
    estimatedCost += scaled(quote.estimatedCostCents, share);
    estimatedMinutes += scaled(quote.estimatedMinutes, share);
  };

  for (const project of target.projects) {
    if (period) {
      const scheduled = scheduleByProject.get(project.id);
      if (scheduled !== undefined) {
        addRevenue({
          key: `schedule:${project.id}`,
          kind: "schedule",
          label: `Échéances de ${project.name} sur la période`,
          amountCents: scheduled,
        });
      } else {
        unavailable.push(`${project.name} : aucune échéance sur la période.`);
      }
      continue;
    }
    const quote = project.quoteId ? quotes.get(project.quoteId) : undefined;
    if (quote) {
      addQuote(quote, 1);
    } else if (project.budgetCents !== null) {
      addRevenue({
        key: `budget:${project.id}`,
        kind: "budget",
        label: `Budget de ${project.name}`,
        amountCents: project.budgetCents,
      });
    } else {
      unavailable.push(`${project.name} : ni devis ni budget, revenu prévisionnel inconnu.`);
    }
  }

  for (const { contract, share } of target.contracts) {
    const quote = contract.quoteId ? quotes.get(contract.quoteId) : undefined;
    // Un devis qui finance déjà un projet ne se compte pas une seconde fois comme revenu du contrat.
    if (quote && !period && !quotesWithProject.has(quote.id)) {
      addQuote(quote, share);
    } else if (contract.priceCents > 0 && contract.startOn) {
      const to = period?.to ?? contract.endOn ?? today;
      const end = contract.endOn && contract.endOn < to ? contract.endOn : to;
      const occurrences = countOccurrences(contract.startOn, contract.period, {
        from: period?.from,
        to: end,
      });
      addRevenue({
        key: `contract:${contract.id}`,
        kind: "contract_price",
        label: `Prix du contrat ${contract.number}`,
        amountCents: scaled(contract.priceCents * occurrences, share),
        detail: `${occurrences} période${occurrences > 1 ? "s" : ""}${share < 1 ? ` · part de ${Math.round(share * 100)} %` : ""}`,
      });
    } else {
      unavailable.push(`${contract.number} : ni devis ni prix daté, revenu prévisionnel inconnu.`);
    }
  }

  if (estimatedCost > 0 || estimatedMinutes > 0) {
    lines.push({
      key: "time_estimate",
      kind: "time_estimate",
      side: "cost",
      label: "Coût interne estimé au devis",
      amountCents: estimatedCost,
      detail: `${formatMinutes(estimatedMinutes)} estimées`,
    });
  }

  const direct = directCostLines(target, costs, "forecast", period, today);
  lines.push(...direct.lines);
  unavailable.push(...direct.unavailable);

  // Sans coût prévisionnel saisi sur le contrat, son coût mensuel estimé en tient lieu.
  for (const { contract, share } of target.contracts) {
    const hasForecast = costs.some(
      (row) => row.nature === "forecast" && row.contractId === contract.id,
    );
    if (hasForecast || !contract.monthlyCostCents || !contract.startOn) continue;
    const to = period?.to ?? contract.endOn ?? today;
    const months = countOccurrences(contract.startOn, "monthly", {
      from: period?.from,
      to: contract.endOn && contract.endOn < to ? contract.endOn : to,
    });
    if (months === 0) continue;
    lines.push({
      key: `contract_cost:${contract.id}`,
      kind: "contract_cost",
      side: "cost",
      label: `Coût mensuel estimé de ${contract.number}`,
      amountCents: scaled(contract.monthlyCostCents * months, share),
      detail: `${months} mois`,
    });
  }

  return finalize(
    { revenueCents: known ? revenue : null, lines, unavailable },
    { cents: estimatedCost, minutes: estimatedMinutes },
  );
}

async function resolveTargets(
  db: Database,
  scope: MarginScope,
  ids: readonly string[],
): Promise<Target[]> {
  if (scope === "project") {
    const projects = await repository.loadProjects(db, ids);
    return projects.map((project) => ({
      scope,
      id: project.id,
      label: project.name,
      companyId: project.companyId,
      projects: [project],
      contracts: [],
    }));
  }
  if (scope === "contract") {
    const contracts = await repository.loadContracts(db, ids);
    return contracts.map((contract) => ({
      scope,
      id: contract.id,
      label: contract.name,
      companyId: contract.companyId,
      projects: [],
      contracts: [{ contract, share: 1 }],
    }));
  }
  if (scope === "client") {
    const [companies, projects, contracts] = await Promise.all([
      repository.loadCompanies(db, ids),
      repository.loadCompanyProjects(db, ids),
      repository.loadCompanyContracts(db, ids),
    ]);
    return companies.map((company) => ({
      scope,
      id: company.id,
      label: company.name,
      companyId: company.id,
      projects: projects.filter((project) => project.companyId === company.id),
      contracts: contracts
        .filter((contract) => contract.companyId === company.id)
        .map((contract) => ({ contract, share: 1 })),
    }));
  }

  const sites = await repository.loadSites(db, ids);
  const links = await repository.loadSiteContractLinks(db, ids);
  const contractIds = [
    ...new Set([
      ...links.map((link) => link.contractId),
      ...sites.flatMap((site) => (site.contractId ? [site.contractId] : [])),
    ]),
  ];
  const [projects, contracts, contractSites, contractPrimarySites] = await Promise.all([
    repository.loadProjects(
      db,
      sites.flatMap((site) => (site.projectId ? [site.projectId] : [])),
    ),
    repository.loadContracts(db, contractIds),
    repository.loadContractSiteLinks(db, contractIds),
    repository.loadSitesWithContract(db, contractIds),
  ]);

  /** Sites distincts d'un contrat : ses liens, plus le site qui le désigne comme contrat principal. */
  const sitesOfContract = (contractId: string) =>
    new Set([
      ...contractSites.filter((link) => link.contractId === contractId).map((link) => link.siteId),
      ...contractPrimarySites
        .filter((link) => link.contractId === contractId)
        .map((link) => link.siteId),
    ]);

  return sites.map((site) => {
    const own = new Set([
      ...links.filter((link) => link.siteId === site.id).map((link) => link.contractId),
      ...(site.contractId ? [site.contractId] : []),
    ]);
    return {
      scope,
      id: site.id,
      label: site.primaryDomain ?? site.name,
      companyId: site.companyId,
      projects: projects.filter((project) => project.id === site.projectId),
      contracts: contracts
        .filter((contract) => own.has(contract.id))
        .map((contract) => ({
          contract,
          share: 1 / Math.max(1, sitesOfContract(contract.id).size),
        })),
    };
  });
}

interface TimeCost {
  cents: number;
  minutes: number;
}

/**
 * Coût du temps, un seul calcul : celui du module Temps (`getTimeTotals`, dont `getTimeCostCents` lit
 * le coût ; ici il faut aussi les minutes). Lots de 8, pour ne pas saturer le pool.
 */
async function loadTimeCosts(
  db: Database,
  scope: MarginScope,
  ids: readonly string[],
  period: MarginPeriod | null,
): Promise<Map<string, TimeCost>> {
  const result = new Map<string, TimeCost>();
  for (let index = 0; index < ids.length; index += 8) {
    const chunk = ids.slice(index, index + 8);
    const costs = await Promise.all(chunk.map((id) => getTimeTotals(db, { scope, id, period })));
    chunk.forEach((id, position) => {
      const cost = costs[position];
      result.set(id, { cents: cost?.costCents ?? 0, minutes: cost?.minutes ?? 0 });
    });
  }
  return result;
}

export interface GetMarginsInput {
  scope: MarginScope;
  ids: readonly string[];
  period?: MarginPeriod | null;
}

/**
 * Le calcul, par lots. `getMargin` en est le cas d'un seul objet : il n'y a qu'une seule formule.
 * Un identifiant inconnu est simplement absent de la réponse.
 */
export async function getMargins(
  db: Database,
  input: GetMarginsInput,
  now: Date = new Date(),
): Promise<Map<string, MarginBreakdown>> {
  const period = input.period ?? null;
  const today = parisDay(now);
  const targets = await resolveTargets(db, input.scope, input.ids);
  const projectIds = [...new Set(targets.flatMap((target) => target.projects.map((p) => p.id)))];
  const contractIds = [
    ...new Set(targets.flatMap((target) => target.contracts.map((item) => item.contract.id))),
  ];
  const companyIds = input.scope === "client" ? targets.map((target) => target.id) : [];
  const siteIds = input.scope === "site" ? targets.map((target) => target.id) : [];
  const targetIds = targets.map((target) => target.id);

  const quoteIds = [
    ...new Set([
      ...targets.flatMap((target) =>
        target.projects.flatMap((project) => (project.quoteId ? [project.quoteId] : [])),
      ),
      ...targets.flatMap((target) =>
        target.contracts.flatMap(({ contract }) => (contract.quoteId ? [contract.quoteId] : [])),
      ),
    ]),
  ];

  const [documents, costs, quoteRows, quotesWithProject, scheduleRows, timeCosts] =
    await Promise.all([
      repository.loadDocumentGroups(db, { companyIds, projectIds, contractIds }, period),
      repository.loadCostRows(db, { companyIds, projectIds, contractIds, siteIds }),
      repository.loadQuotes(db, quoteIds),
      repository.loadQuoteIdsWithProject(db, quoteIds),
      period ? repository.loadScheduleInPeriod(db, projectIds, period) : Promise.resolve([]),
      loadTimeCosts(db, input.scope, targetIds, period),
    ]);

  const quotes = new Map(quoteRows.map((quote) => [quote.id, quote]));
  const scheduleByProject = new Map<string, number>();
  for (const row of scheduleRows) {
    if (!row.projectId) continue;
    scheduleByProject.set(
      row.projectId,
      (scheduleByProject.get(row.projectId) ?? 0) + row.amountCents,
    );
  }

  return new Map(
    targets.map((target) => [
      target.id,
      {
        scope: target.scope,
        id: target.id,
        label: target.label,
        companyId: target.companyId,
        period,
        forecast: forecastFigures(
          target,
          costs,
          quotes,
          quotesWithProject,
          scheduleByProject,
          period,
          today,
        ),
        actual: actualFigures(
          target,
          documents,
          costs,
          timeCosts.get(target.id) ?? { cents: 0, minutes: 0 },
          period,
          today,
        ),
      },
    ]),
  );
}

/**
 * Source unique du calcul de marge : `marge HT = revenus HT attribués − coûts directs attribués`,
 * coût du temps inclus. Tableau de bord, projet, fiche client et finances appellent cette fonction
 * et rien d'autre. Réservé à `finance:read` : à vérifier par le service appelant.
 */
export async function getMargin(
  db: Database,
  rawInput: GetMarginInput,
  now: Date = new Date(),
): Promise<MarginBreakdown> {
  const input = parseInput(marginInputSchema, rawInput);
  const margins = await getMargins(
    db,
    { scope: input.scope, ids: [input.id], period: input.period },
    now,
  );
  const margin = margins.get(input.id);
  if (!margin) throw new NotFoundError("Élément introuvable.");
  return margin;
}

/** `getMargin` pour un écran : droits vérifiés, objet absent en 404. */
export async function getMarginForActor(
  ctx: ServiceContext,
  input: GetMarginInput,
): Promise<MarginBreakdown> {
  assertCan(ctx.actor, "finance:read");
  // Une valeur d'URL : un identifiant impossible est un objet introuvable, pas une erreur.
  if (!marginIdSchema.safeParse(input.id).success) throw new NotFoundError("Élément introuvable.");
  return getMargin(ctx.db, input);
}

export interface ProfitabilityRow {
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  companyId: string;
  margin: MarginBreakdown;
}

const SUBJECT_LOADERS = {
  project: repository.listProjectSubjects,
  client: repository.listClientSubjects,
  site: repository.listSiteSubjects,
  contract: repository.listContractSubjects,
} as const;

/** Page de rentabilité d'une portée, paginée côté serveur. */
export async function listProfitability(
  ctx: ServiceContext,
  scope: MarginScope,
  search: string | null,
  params: PageParams,
  now: Date = new Date(),
): Promise<Paginated<ProfitabilityRow>> {
  assertCan(ctx.actor, "finance:read");
  parseInput(marginScopeSchema, scope);
  const page = await SUBJECT_LOADERS[scope](ctx.db, search?.trim() || null, params);
  const margins = await getMargins(ctx.db, { scope, ids: page.items.map((item) => item.id) }, now);
  return {
    ...page,
    items: page.items.flatMap((item) => {
      const margin = margins.get(item.id);
      return margin ? [{ ...item, margin }] : [];
    }),
  };
}

export interface AverageMargin {
  /** Marge réelle pondérée par le revenu : `Σ marges / Σ revenus`. NULL si rien n'est calculable. */
  percent: number | null;
  projects: number;
}

/** Marge réelle moyenne des projets facturés : les 200 plus récents, tous passés par `getMargins`. */
export async function getAverageActualMargin(
  db: Database,
  now: Date = new Date(),
): Promise<AverageMargin> {
  const ids = await repository.listProjectIdsWithInvoices(db, 200);
  const margins = await getMargins(db, { scope: "project", ids }, now);
  let revenue = 0;
  let margin = 0;
  let projects = 0;
  for (const item of margins.values()) {
    if (item.actual.revenueCents === null || item.actual.marginCents === null) continue;
    revenue += item.actual.revenueCents;
    margin += item.actual.marginCents;
    projects += 1;
  }
  return { percent: revenue > 0 ? (margin / revenue) * 100 : null, projects };
}

export interface ProfitabilityOverview {
  average: AverageMargin;
  /** Projets les plus récents de l'écran 21. */
  projects: ProfitabilityRow[];
  projectTotal: number;
  /** Clients qui ont le plus de revenus, triés par marge réelle. Jauges de l'écran 21. */
  clients: ProfitabilityRow[];
}

export async function getProfitabilityOverview(
  ctx: ServiceContext,
  now: Date = new Date(),
): Promise<ProfitabilityOverview> {
  assertCan(ctx.actor, "finance:read");
  const [average, projects, clients] = await Promise.all([
    getAverageActualMargin(ctx.db, now),
    listProfitability(ctx, "project", null, { page: 1, pageSize: 6 }, now),
    listProfitability(ctx, "client", null, { page: 1, pageSize: 5 }, now),
  ]);
  return {
    average,
    projects: projects.items,
    projectTotal: projects.total,
    clients: clients.items
      .filter((row) => row.margin.actual.marginPercent !== null)
      .sort((a, b) => (b.margin.actual.marginPercent ?? 0) - (a.margin.actual.marginPercent ?? 0)),
  };
}
