import {
  CONTRACT_KINDS,
  SIGNATURE_STATUS_LABELS,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  CONTRACT_KIND_LABELS,
  type ContractKind,
  type ContractStatus,
  type TicketCategory,
  type TicketCoverage,
} from "@/lib/domain-enums";
import { formatDateNumeric, formatMinutes } from "@/lib/format";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  listCompanyOptions,
  listContactOptions,
  type CompanyOption,
  type ContactOption,
} from "@/modules/crm/company.lookup";
import { listDocumentsFor } from "@/modules/documents/document.service";
import type { DocumentSummary } from "@/modules/documents/document.types";
import { getMargin, type MarginBreakdown } from "@/modules/finance/profitability.service";
import { emitEvent } from "@/modules/platform/events";
import { nextNumber } from "@/modules/platform/sequences";
import { createChangeRequest, linkChangeRequestQuote } from "@/modules/projects/production.service";
import { createQuote, listQuotes, listQuotesForCompany } from "@/modules/quotes/quote.service";
import { listDomains } from "@/modules/sites/domain.service";
import { listAssignableMembers, type MemberOption } from "@/modules/team/team.lookup";
import { assertCan, can, type Actor } from "@/server/auth/permissions";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { Contract } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { paginated, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { emitQuotaEvents, readConsumption, readConsumptions } from "./contract-quota";
import { periodLabel } from "./contract.format";
import {
  addBillingPeriod,
  addDays,
  addMonths,
  categoryCovered,
  earliest,
  monthlyAmountCents,
  nextAutoRenewal,
  nextDeadline,
  parisDay,
  periodWindow,
  PRICE_REVIEW_MONTHS,
  quotaExhausted,
  RENEWAL_WINDOW_DAYS,
  worstQuotaPercent,
} from "./contract.rules";
import * as repository from "./contract.repository";
import {
  changePriceSchema,
  changeStatusSchema,
  consumeQuotaSchema,
  contractNoteSchema,
  coverageInputSchema,
  createContractSchema,
  listContractsSchema,
  overageSchema,
  renewContractSchema,
  signatureSchema,
  siteLinkSchema,
  terminateContractSchema,
  updateContractSchema,
} from "./contract.schema";
import { assertContractTransition } from "./contract.status";
import type {
  CompanyContractRow,
  ContractConsumption,
  ContractDetail,
  ContractEventRow,
  ContractListRow,
  ContractSiteRow,
  ContractsSummary,
  ContractTicketRow,
  DomainDeadlineRow,
  InterventionRow,
  MaintenancePlanRow,
  PortalContractRow,
  PriceReviewRow,
  QuoteOption,
  QuotaRow,
  RecurringRevenue,
  RenewalRow,
  SiteOption,
  TerminationImpact,
} from "./contract.types";

/** Les coûts d'un contrat ne se lisent qu'avec ces droits (domain-model §5). */
function canReadCosts(actor: Pick<Actor, "role">): boolean {
  return can(actor, "finance:read") || can(actor, "team:read_costs");
}

/** Le contrat, ou un 404 : un objet archivé, hors périmètre ou à l'adresse illisible n'existe pas. */
async function requireContract(db: Database, id: string): Promise<Contract> {
  const contract = await repository.findContract(db, id);
  if (!contract) throw new NotFoundError("Contrat introuvable.");
  return contract;
}

async function lockForWrite(tx: Database, id: string): Promise<Contract> {
  const contract = await repository.lockContract(tx, id);
  if (!contract) throw new NotFoundError("Contrat introuvable.");
  return contract;
}

function assertEditable(contract: Contract): void {
  if (contract.status === "terminated" || contract.status === "expired") {
    throw new ConflictError("Ce contrat est terminé : il ne se modifie plus.");
  }
}

// --- Lectures de l'écran 20 --------------------------------------------------------------------

export async function listContracts(
  ctx: ServiceContext,
  query: unknown,
  params: PageParams,
): Promise<Paginated<ContractListRow>> {
  assertCan(ctx.actor, "contracts:read");
  const filters = parseInput(listContractsSchema, query);
  const { items, total } = await repository.listContractsPage(ctx.db, filters, params);
  if (items.length === 0 && total > 0 && params.page > 1) {
    // Une page au-delà de la dernière (adresse ancienne ou modifiée) retombe sur la dernière.
    const last = { ...params, page: Math.ceil(total / params.pageSize) };
    const lastPage = await repository.listContractsPage(ctx.db, filters, last);
    return paginated(lastPage.items, lastPage.total, last);
  }
  return paginated(items, total, params);
}

export interface ContractsOverview {
  summary: ContractsSummary;
  quotas: QuotaRow[];
  recentInterventions: InterventionRow[];
  renewals: RenewalRow[];
  priceReviews: PriceReviewRow[];
  /** NULL sans `sites:read`. */
  domains: DomainDeadlineRow[] | null;
}

/** Lignes de consommation, de la plus entamée à la moins entamée. */
async function listQuotaRows(db: Database, day: string): Promise<QuotaRow[]> {
  const contracts = await repository.listQuotaContracts(db);
  const consumptions = await readConsumptions(db, contracts, day);
  return contracts
    .flatMap((contract) => {
      const consumption = consumptions.get(contract.id);
      if (!consumption) return [];
      return [
        {
          ...consumption,
          contractId: contract.id,
          companyName: contract.companyName,
          contractName: contract.name,
          kind: contract.kind,
          period: contract.period,
          percent: worstQuotaPercent(consumption),
        },
      ];
    })
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
}

function averagePercent(rows: readonly QuotaRow[]): number | null {
  const percents = rows
    .map((row) => row.percent)
    .filter((value): value is number => value !== null);
  if (percents.length === 0) return null;
  return percents.reduce((sum, value) => sum + value, 0) / percents.length;
}

async function listPriceReviews(db: Database, today: string): Promise<PriceReviewRow[]> {
  const bases = await repository.listPriceReviewBases(db);
  const rows = bases.flatMap(({ startOn, lastChange, ...base }) => {
    const reference = lastChange ? parisDay(lastChange) : startOn;
    if (!reference) return [];
    return [{ ...base, reviewOn: addMonths(reference, PRICE_REVIEW_MONTHS) }];
  });
  // Les contrats marqués « À revoir » d'abord, puis les révisions les plus proches.
  const rank = (row: PriceReviewRow) =>
    row.status === "to_review" || row.reviewOn <= today ? 0 : 1;
  return rows.sort((a, b) => rank(a) - rank(b) || a.reviewOn.localeCompare(b.reviewOn));
}

const OVERVIEW_LIMIT = {
  quotas: 5,
  interventions: 5,
  renewals: 4,
  reviews: 3,
  domains: 2,
} as const;
const RENEWAL_PANEL_DAYS = 90;

/** Prochains domaines à renouveler, par le service des sites. */
async function readDomainDeadlines(
  ctx: ServiceContext,
  now: Date,
): Promise<DomainDeadlineRow[] | null> {
  if (!can(ctx.actor, "sites:read")) return null;
  const { items } = await listDomains(ctx, {}, { page: 1, pageSize: OVERVIEW_LIMIT.domains }, now);
  return items.flatMap((domain) =>
    domain.expiresOn
      ? [{ name: domain.name, expiresOn: domain.expiresOn, companyName: domain.companyName }]
      : [],
  );
}

export async function getContractsOverview(
  ctx: ServiceContext,
  options: { now?: Date } = {},
): Promise<ContractsOverview> {
  assertCan(ctx.actor, "contracts:read");
  const now = options.now ?? new Date();
  const today = parisDay(now);
  const [summary, quotas, recentInterventions, renewals, priceReviews, domains] = await Promise.all(
    [
      getContractsSummary(ctx.db, { now }),
      listQuotaRows(ctx.db, today),
      repository.listRecentInterventions(ctx.db, OVERVIEW_LIMIT.interventions),
      repository.listDueContracts(
        ctx.db,
        addDays(today, RENEWAL_PANEL_DAYS),
        OVERVIEW_LIMIT.renewals,
      ),
      listPriceReviews(ctx.db, today),
      readDomainDeadlines(ctx, now),
    ],
  );
  return {
    summary,
    quotas: quotas.slice(0, OVERVIEW_LIMIT.quotas),
    recentInterventions,
    renewals,
    priceReviews: priceReviews.slice(0, OVERVIEW_LIMIT.reviews),
    domains,
  };
}

export interface ContractFormOptions {
  companies: CompanyOption[];
  plans: MaintenancePlanRow[];
  /** Devis acceptés, à proposer comme origine une fois le client choisi. Vide sans `quotes:read`. */
  quotes: QuoteOption[];
  canReadCosts: boolean;
}

const QUOTE_OPTION_LIMIT = 100;

/** Listes de choix du formulaire de création. */
export async function getContractFormOptions(ctx: ServiceContext): Promise<ContractFormOptions> {
  assertCan(ctx.actor, "contracts:create");
  const [companies, plans, quotes] = await Promise.all([
    listCompanyOptions(ctx.db, { limit: 1000 }),
    repository.listPlans(ctx.db, { activeOnly: true }),
    can(ctx.actor, "quotes:read")
      ? listQuotes(ctx, { filter: "signes", pageSize: QUOTE_OPTION_LIMIT })
      : Promise.resolve({ items: [] }),
  ]);
  return {
    companies,
    plans,
    quotes: quotes.items.map(({ id, companyId, number, title }) => ({
      id,
      companyId,
      number,
      title,
    })),
    canReadCosts: canReadCosts(ctx.actor),
  };
}

// --- Fiche de contrat --------------------------------------------------------------------------

export interface ContractRecord {
  contract: ContractDetail;
  consumption: ContractConsumption;
  events: ContractEventRow[];
  sites: ContractSiteRow[];
  siteOptions: SiteOption[];
  members: MemberOption[];
  plans: MaintenancePlanRow[];
  contacts: ContactOption[];
  impact: TerminationImpact;
  /** NULL sans `finance:read`, ou si le calcul n'est pas disponible. */
  margin: MarginBreakdown | null;
  /** NULL sans droit de lecture des documents. */
  documents: DocumentSummary[] | null;
  /** Couvert, non couvert ou hors forfait pour chaque catégorie de demande, à ce jour. */
  coverage: { category: TicketCategory; decision: CoverageDecision }[];
  /** Demandes du contrat, ouvertes d'abord. NULL sans `support:read`. */
  tickets: ContractTicketRow[] | null;
  ticketTotal: number;
  /** Devis acceptés du client, pour qui peut modifier le contrat. */
  quoteOptions: QuoteOption[];
  today: string;
}

function toDetail(
  contract: Contract,
  labels: { companyName: string; planName: string | null; quoteNumber: string | null },
  awaitsGoLive: boolean,
  actor: Actor,
): ContractDetail {
  return {
    id: contract.id,
    number: contract.number,
    name: contract.name,
    kind: contract.kind,
    status: contract.status,
    companyId: contract.companyId,
    companyName: labels.companyName,
    planId: contract.planId,
    planName: labels.planName,
    quoteId: contract.quoteId,
    quoteNumber: labels.quoteNumber,
    priceCents: contract.priceCents,
    period: contract.period,
    startOn: contract.startOn,
    renewsOn: contract.renewsOn,
    endOn: contract.endOn,
    autoRenew: contract.autoRenew,
    nextDueOn: nextDeadline(contract),
    awaitsGoLive,
    monthlyCostCents: canReadCosts(actor) ? contract.monthlyCostCents : null,
    includedMinutes: contract.includedMinutes,
    includedTickets: contract.includedTickets,
    scope: contract.scope,
    exclusions: contract.exclusions,
    conditions: contract.conditions,
    responseHours: contract.responseHours,
    resolutionHours: contract.resolutionHours,
    signatureStatus: contract.signatureStatus,
    docusealSubmissionId: contract.docusealSubmissionId,
    terminatedAt: contract.terminatedAt,
    terminationNote: contract.terminationNote,
    createdAt: contract.createdAt,
  };
}

/** Marge du contrat, seulement pour qui lit les finances. Indisponible : NULL, jamais un zéro. */
async function readMargin(
  ctx: ServiceContext,
  contractId: string,
): Promise<MarginBreakdown | null> {
  if (!can(ctx.actor, "finance:read")) return null;
  try {
    return await getMargin(ctx.db, { scope: "contract", id: contractId });
  } catch (error) {
    logger.warn("contract.margin_unavailable", { contractId, error });
    return null;
  }
}

async function readTerminationImpact(
  ctx: ServiceContext,
  contract: Contract,
  linkedSites: ContractSiteRow[],
): Promise<TerminationImpact> {
  const finance = can(ctx.actor, "finance:read");
  // Sans site rattaché, le contrat vaut pour tous les sites du client : ce sont eux qui sont concernés.
  const sites =
    linkedSites.length > 0
      ? linkedSites
      : await repository.listCompanySites(ctx.db, contract.companyId);
  const siteIds = sites.map((site) => site.siteId);
  const [plannedInterventions, openTickets, domains, recurringCosts, plannedScheduleItems] =
    await Promise.all([
      repository.countPlannedInterventions(ctx.db, contract.id),
      repository.countOpenTickets(ctx.db, contract.id),
      repository.listDomainsOfSites(ctx.db, siteIds),
      finance ? repository.listRecurringCosts(ctx.db, contract.id, siteIds) : Promise.resolve(null),
      finance ? repository.countPlannedScheduleItems(ctx.db, contract.id) : Promise.resolve(null),
    ]);
  return {
    sites,
    domains,
    plannedInterventions,
    openTickets,
    recurringCosts,
    plannedScheduleItems,
  };
}

const RECORD_TICKET_LIMIT = 5;

/** Devis acceptés du client, et le devis déjà lié s'il ne l'est plus. */
async function readQuoteOptions(ctx: ServiceContext, contract: Contract): Promise<QuoteOption[]> {
  if (!can(ctx.actor, "contracts:update") || !can(ctx.actor, "quotes:read")) return [];
  const rows = await listQuotesForCompany(ctx, contract.companyId, { limit: QUOTE_OPTION_LIMIT });
  return rows
    .filter((row) => row.status === "accepted" || row.id === contract.quoteId)
    .map(({ id, number, title }) => ({ id, companyId: contract.companyId, number, title }));
}

const RECORD_EVENT_LIMIT = 50;
const RECORD_DOCUMENT_LIMIT = 5;

/** Le contrat existe et l'appelant peut le lire, sinon 404. Sert à répondre avant tout affichage. */
export async function assertContractReadable(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "contracts:read");
  await requireContract(ctx.db, id);
}

export async function getContractRecord(
  ctx: ServiceContext,
  id: string,
  options: { now?: Date } = {},
): Promise<ContractRecord> {
  assertCan(ctx.actor, "contracts:read");
  const contract = await requireContract(ctx.db, id);
  const now = options.now ?? new Date();
  const today = parisDay(now);
  const [
    labels,
    awaitsGoLive,
    consumption,
    events,
    sites,
    siteOptions,
    members,
    plans,
    margin,
    contacts,
    documents,
    coverage,
    tickets,
    quoteOptions,
  ] = await Promise.all([
    repository.findContractLabels(ctx.db, contract),
    repository.contractAwaitsGoLive(ctx.db, contract.id),
    readConsumption(ctx.db, contract, today),
    repository.listEvents(ctx.db, contract.id, RECORD_EVENT_LIMIT),
    repository.listLinkedSites(ctx.db, contract.id),
    repository.listCompanySiteOptions(ctx.db, contract.companyId),
    listAssignableMembers(ctx.db),
    repository.listPlans(ctx.db, { activeOnly: false }),
    readMargin(ctx, contract.id),
    listContactOptions(ctx.db, contract.companyId),
    can(ctx.actor, "documents:read")
      ? listDocumentsFor(ctx, { contractId: contract.id, limit: RECORD_DOCUMENT_LIMIT })
      : Promise.resolve(null),
    Promise.all(
      TICKET_CATEGORIES.map(async (category) => ({
        category,
        decision: await resolveCoverage(ctx.db, {
          companyId: contract.companyId,
          contractId: contract.id,
          category,
          now,
        }),
      })),
    ),
    can(ctx.actor, "support:read")
      ? repository.listContractTickets(ctx.db, contract.id, RECORD_TICKET_LIMIT)
      : Promise.resolve(null),
    readQuoteOptions(ctx, contract),
  ]);
  const impact = await readTerminationImpact(ctx, contract, sites);
  return {
    contract: toDetail(contract, labels, awaitsGoLive, ctx.actor),
    consumption,
    events,
    sites,
    siteOptions,
    members,
    plans,
    contacts,
    impact,
    margin,
    documents,
    coverage,
    tickets: tickets?.items ?? null,
    ticketTotal: tickets?.total ?? 0,
    quoteOptions,
    today,
  };
}

// --- Écritures ---------------------------------------------------------------------------------

export async function createContract(ctx: ServiceContext, input: unknown): Promise<Contract> {
  assertCan(ctx.actor, "contracts:create");
  const data = parseInput(createContractSchema, input);

  return ctx.db.transaction(async (tx) => {
    if (!(await repository.lockCompanyForContract(tx, data.companyId))) {
      throw new NotFoundError("Client introuvable.");
    }
    if (await repository.openContractNamed(tx, data.companyId, data.name)) {
      throw new ConflictError("Ce client a déjà un contrat en cours portant ce nom.", {
        name: ["Un contrat en cours porte déjà ce nom."],
      });
    }
    if (
      data.quoteId &&
      !(await repository.quoteBelongsToCompany(tx, data.quoteId, data.companyId))
    ) {
      throw new NotFoundError("Devis introuvable pour ce client.");
    }
    const plan = data.planId ? await repository.findPlan(tx, data.planId) : null;
    if (data.planId && !plan?.active) {
      throw new ValidationError("Cette formule n'est plus proposée.", {
        planId: ["Formule inactive ou inconnue."],
      });
    }

    const contract = await repository.insertContract(tx, {
      number: await nextNumber(tx, "contract"),
      companyId: data.companyId,
      planId: data.planId,
      quoteId: data.quoteId,
      name: data.name,
      kind: data.kind,
      status: "to_start",
      startOn: data.startOn,
      endOn: data.endOn,
      renewsOn: data.renewsOn,
      autoRenew: data.autoRenew,
      priceCents: data.priceCents,
      period: data.period,
      monthlyCostCents: canReadCosts(ctx.actor) ? data.monthlyCostCents : null,
      // Laissé vide : la valeur de la formule.
      includedMinutes: data.includedMinutes ?? plan?.includedMinutes ?? null,
      includedTickets: data.includedTickets ?? plan?.includedTickets ?? null,
      scope: data.scope ?? plan?.scope ?? null,
      exclusions: data.exclusions ?? plan?.exclusions ?? null,
      conditions: data.conditions,
      responseHours: data.responseHours ?? plan?.responseHours ?? null,
      resolutionHours: data.resolutionHours ?? plan?.resolutionHours ?? null,
    });
    await repository.insertEvent(tx, {
      contractId: contract.id,
      kind: "created",
      toPriceCents: contract.priceCents,
      actorId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.created",
      entityType: "contract",
      entityId: contract.id,
      metadata: { number: contract.number, companyId: contract.companyId, kind: contract.kind },
    });
    return contract;
  });
}

/** Ce qu'une modification peut changer, et comment le nommer dans l'historique. */
const CHANGE_LABELS = {
  name: "nom",
  kind: "type",
  planId: "formule",
  quoteId: "devis d'origine",
  startOn: "début",
  endOn: "fin",
  renewsOn: "échéance de renouvellement",
  autoRenew: "renouvellement automatique",
  includedMinutes: "temps inclus",
  includedTickets: "demandes incluses",
  scope: "périmètre",
  exclusions: "exclusions",
  conditions: "conditions",
  responseHours: "délai de réponse",
  resolutionHours: "délai de résolution",
} as const satisfies Partial<Record<keyof Contract, string>>;

export async function updateContract(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  options: { now?: Date } = {},
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(updateContractSchema, input);
  const today = parisDay(options.now ?? new Date());

  return ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    assertEditable(contract);
    if (await repository.openContractNamed(tx, contract.companyId, data.name, contract.id)) {
      throw new ConflictError("Ce client a déjà un contrat en cours portant ce nom.", {
        name: ["Un contrat en cours porte déjà ce nom."],
      });
    }
    if (
      data.quoteId &&
      !(await repository.quoteBelongsToCompany(tx, data.quoteId, contract.companyId))
    ) {
      throw new NotFoundError("Devis introuvable pour ce client.");
    }
    if (data.planId && data.planId !== contract.planId) {
      const plan = await repository.findPlan(tx, data.planId);
      if (!plan?.active) {
        throw new ValidationError("Cette formule n'est plus proposée.", {
          planId: ["Formule inactive ou inconnue."],
        });
      }
    }

    // Un contrat déjà démarré ne repasse pas par le démarrage : son échéance automatique se pose ici.
    const startOn = data.startOn ?? contract.startOn;
    const renewsOn =
      data.autoRenew && !data.renewsOn && contract.status !== "to_start" && startOn
        ? nextAutoRenewal(startOn, contract.period, today, data.endOn)
        : data.renewsOn;
    const terms = {
      planId: data.planId,
      quoteId: data.quoteId,
      name: data.name,
      kind: data.kind,
      startOn: data.startOn,
      endOn: data.endOn,
      renewsOn,
      autoRenew: data.autoRenew,
      includedMinutes: data.includedMinutes,
      includedTickets: data.includedTickets,
      scope: data.scope,
      exclusions: data.exclusions,
      conditions: data.conditions,
      responseHours: data.responseHours,
      resolutionHours: data.resolutionHours,
    };
    const monthlyCostCents = canReadCosts(ctx.actor)
      ? data.monthlyCostCents
      : contract.monthlyCostCents;
    const changed = (Object.keys(CHANGE_LABELS) as (keyof typeof CHANGE_LABELS)[]).filter(
      (key) => terms[key] !== contract[key],
    );
    const costChanged = monthlyCostCents !== contract.monthlyCostCents;
    if (changed.length === 0 && !costChanged) return contract;

    // La périodicité se change avec le prix (révision de tarif) : les deux font le MRR.
    const updated = await repository.updateContract(tx, id, { ...terms, monthlyCostCents });
    if (changed.length > 0) {
      await repository.insertEvent(tx, {
        contractId: id,
        kind: "note",
        note: `Modifié : ${changed.map((key) => CHANGE_LABELS[key]).join(", ")}.`,
        actorId: ctx.actor.userId,
      });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.updated",
      entityType: "contract",
      entityId: id,
      metadata: { number: contract.number, changed, costChanged },
    });
    return updated;
  });
}

/** Révision de tarif (08.04.02). Même prix et même périodicité : rien ne change, rien ne s'écrit. */
export async function changeContractPrice(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(changePriceSchema, input);

  return ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    assertEditable(contract);
    if (contract.priceCents === data.priceCents && contract.period === data.period) return contract;

    const updated = await repository.updateContract(tx, id, {
      priceCents: data.priceCents,
      period: data.period,
    });
    await repository.insertEvent(tx, {
      contractId: id,
      kind: "price_change",
      fromPriceCents: contract.priceCents,
      toPriceCents: data.priceCents,
      note:
        contract.period === data.period
          ? data.note
          : [
              `Périodicité : ${periodLabel(contract.period)} → ${periodLabel(data.period)}.`,
              data.note,
            ]
              .filter(Boolean)
              .join(" "),
      actorId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.price_changed",
      entityType: "contract",
      entityId: id,
      metadata: {
        number: contract.number,
        fromPriceCents: contract.priceCents,
        toPriceCents: data.priceCents,
        fromPeriod: contract.period,
        toPeriod: data.period,
      },
    });
    return updated;
  });
}

async function applyRenewal(
  tx: Database,
  contract: Contract,
  options: { newNextOn: string; note: string | null; actorId: string | null },
): Promise<Contract> {
  const previous = nextDeadline(contract);
  let endOn: string | null = null;
  if (contract.endOn) {
    // La fin avance d'une période, sans jamais rester avant la nouvelle échéance.
    const pushed = contract.renewsOn
      ? addBillingPeriod(contract.endOn, contract.period)
      : options.newNextOn;
    endOn = pushed < options.newNextOn ? options.newNextOn : pushed;
  }
  const updated = await repository.updateContract(tx, contract.id, {
    renewsOn: contract.renewsOn ? options.newNextOn : null,
    endOn,
  });
  const moved = previous
    ? `Échéance du ${formatDateNumeric(previous)} portée au ${formatDateNumeric(options.newNextOn)}.`
    : `Échéance portée au ${formatDateNumeric(options.newNextOn)}.`;
  await repository.insertEvent(tx, {
    contractId: contract.id,
    kind: "renewed",
    note: options.note ? `${moved} ${options.note}` : moved,
    actorId: options.actorId,
  });
  await recordAudit(tx, {
    actorId: options.actorId,
    action: "contract.renewed",
    entityType: "contract",
    entityId: contract.id,
    metadata: { number: contract.number, nextDueOn: options.newNextOn },
  });
  return updated;
}

/**
 * Renouvelle d'une période, ou jusqu'à la date choisie. `expectedNextOn` : l'échéance vue à l'écran.
 * Si elle a déjà bougé, le renouvellement a eu lieu : rien de plus ne s'écrit.
 */
export async function renewContract(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(renewContractSchema, input);

  return ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    if (contract.status !== "active" && contract.status !== "to_review") {
      throw new ConflictError("Seul un contrat en vigueur se renouvelle.");
    }
    const current = nextDeadline(contract);
    if (data.expectedNextOn && current !== data.expectedNextOn) return contract;
    if (!current) {
      throw new ConflictError("Ce contrat n'a ni échéance ni date de fin : rien à renouveler.");
    }
    const newNextOn = data.newRenewsOn ?? addBillingPeriod(current, contract.period);
    if (newNextOn <= current) {
      throw new ValidationError("La nouvelle échéance doit suivre l'échéance actuelle.", {
        newRenewsOn: ["Choisissez une date après l'échéance actuelle."],
      });
    }
    return applyRenewal(tx, contract, {
      newNextOn,
      note: data.note,
      actorId: ctx.actor.userId,
    });
  });
}

const STATUS_NOTES: Partial<Record<`${ContractStatus}>${ContractStatus}`, string>> = {
  "to_start>active": "Contrat démarré.",
  "to_review>active": "Révision terminée.",
  "suspended>active": "Contrat repris.",
  "active>to_review": "Contrat à revoir.",
  "active>expired": "Contrat arrivé à son terme.",
};

async function applyStatusChange(
  tx: Database,
  contract: Contract,
  to: "active" | "to_review" | "suspended" | "expired",
  options: { note: string | null; actorId: string | null; today: string },
): Promise<Contract> {
  assertContractTransition(contract.status, to);

  const patch: Partial<Contract> = { status: to };
  if (contract.status === "to_start") {
    const startOn = contract.startOn ?? options.today;
    patch.startOn = startOn;
    if (contract.autoRenew && !contract.renewsOn) {
      const renewsOn = addBillingPeriod(startOn, contract.period);
      patch.renewsOn = contract.endOn && contract.endOn < renewsOn ? contract.endOn : renewsOn;
    }
  }
  const updated = await repository.updateContract(tx, contract.id, patch);

  const generated = STATUS_NOTES[`${contract.status}>${to}`];
  await repository.insertEvent(tx, {
    contractId: contract.id,
    kind: to === "suspended" ? "suspended" : "note",
    note: options.note ?? generated ?? null,
    actorId: options.actorId,
  });
  await recordAudit(tx, {
    actorId: options.actorId,
    action: to === "suspended" ? "contract.suspended" : "contract.status_changed",
    entityType: "contract",
    entityId: contract.id,
    metadata: { number: contract.number, from: contract.status, to },
  });
  return updated;
}

/**
 * Changement d'état, hors résiliation. Le même état une seconde fois ne change rien ; une transition
 * absente de la machine lève une `ConflictError`.
 */
export async function changeContractStatus(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  options: { now?: Date } = {},
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(changeStatusSchema, input);
  const today = parisDay(options.now ?? new Date());

  return ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    if (contract.status === data.status) return contract;
    if (data.status === "expired" && (!contract.endOn || contract.endOn > today)) {
      throw new ConflictError("Ce contrat n'a pas atteint sa date de fin.");
    }
    return applyStatusChange(tx, contract, data.status, {
      note: data.note,
      actorId: ctx.actor.userId,
      today,
    });
  });
}

/**
 * Résiliation (08.04.03) : effet immédiat, à la date indiquée, au plus tard aujourd'hui. Une fin à
 * échéance se fait autrement : date de fin et renouvellement automatique coupé. Les interventions
 * prévues sont annulées ; les services à arrêter restent listés sur la fiche.
 */
export async function terminateContract(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  options: { now?: Date } = {},
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:terminate");
  const data = parseInput(terminateContractSchema, input);
  const now = options.now ?? new Date();
  const today = parisDay(now);

  return ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    if (contract.status === "terminated") return contract;
    assertContractTransition(contract.status, "terminated");

    const effectiveOn = data.effectiveOn ?? today;
    if (effectiveOn > today) {
      throw new ValidationError("La résiliation ne peut pas être postdatée.", {
        effectiveOn: ["Pour une fin à échéance, modifiez la date de fin du contrat."],
      });
    }
    if (contract.startOn && effectiveOn < contract.startOn) {
      throw new ValidationError("La résiliation ne peut pas précéder le début du contrat.", {
        effectiveOn: ["Choisissez une date après le début du contrat."],
      });
    }

    // Les transferts à prévoir restent lisibles sur la fiche, avec le motif.
    const note = data.transfers ? `${data.note}\nTransferts : ${data.transfers}` : data.note;
    const updated = await repository.updateContract(tx, id, {
      status: "terminated",
      terminatedAt: now,
      terminationNote: note,
      endOn: effectiveOn,
      renewsOn: null,
      autoRenew: false,
    });
    await repository.cancelPlannedInterventions(tx, id);
    await repository.insertEvent(tx, {
      contractId: id,
      kind: "terminated",
      note,
      actorId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.terminated",
      entityType: "contract",
      entityId: id,
      metadata: { number: contract.number, effectiveOn },
    });
    await emitEvent(tx, {
      type: "contract.terminated",
      entityType: "contract",
      entityId: id,
      companyId: contract.companyId,
      payload: { number: contract.number, terminatedAt: now.toISOString(), note },
      actorId: ctx.actor.userId,
      dedupeKey: `contract.terminated:${id}`,
    });
    return updated;
  });
}

/** Archivage : seulement un contrat jamais démarré ou terminé. L'historique reste en base. */
export async function archiveContract(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "contracts:terminate");
  await ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    if (!["to_start", "terminated", "expired"].includes(contract.status)) {
      throw new ConflictError("Un contrat en vigueur se résilie avant d'être archivé.");
    }
    await repository.updateContract(tx, id, { archivedAt: new Date() });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.archived",
      entityType: "contract",
      entityId: id,
      metadata: { number: contract.number },
    });
  });
}

export async function addContractNote(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<void> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(contractNoteSchema, input);
  await ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    await repository.insertEvent(tx, {
      contractId: id,
      kind: "note",
      note: data.note,
      actorId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.updated",
      entityType: "contract",
      entityId: id,
      metadata: { number: contract.number, note: true },
    });
  });
}

/** État de signature saisi à la main : aucune signature n'est simulée ni déclenchée ici. */
export async function updateContractSignature(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(signatureSchema, input);
  return ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    assertEditable(contract);
    if (contract.signatureStatus === data.status) return contract;
    const updated = await repository.updateContract(tx, id, { signatureStatus: data.status });
    await repository.insertEvent(tx, {
      contractId: id,
      kind: "note",
      note: `Signature : ${SIGNATURE_STATUS_LABELS[data.status]} (saisie manuelle).`,
      actorId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.updated",
      entityType: "contract",
      entityId: id,
      metadata: {
        number: contract.number,
        fromSignature: contract.signatureStatus,
        toSignature: data.status,
        source: "manual",
      },
    });
    return updated;
  });
}

export async function linkContractSite(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<void> {
  assertCan(ctx.actor, "contracts:update");
  const { siteId } = parseInput(siteLinkSchema, input);
  await ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    assertEditable(contract);
    const site = await repository.findCompanySite(tx, siteId, contract.companyId);
    // Le site d'un autre client n'existe pas pour ce contrat, et la clé composite le refuserait.
    if (!site) throw new NotFoundError("Site introuvable pour ce client.");
    const created = await repository.linkSite(tx, {
      contractId: id,
      siteId,
      companyId: contract.companyId,
    });
    if (!created) return;
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.site_linked",
      entityType: "contract",
      entityId: id,
      metadata: { number: contract.number, siteId },
    });
  });
}

export async function unlinkContractSite(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<void> {
  assertCan(ctx.actor, "contracts:update");
  const { siteId } = parseInput(siteLinkSchema, input);
  await ctx.db.transaction(async (tx) => {
    const contract = await lockForWrite(tx, id);
    assertEditable(contract);
    if ((await repository.findSiteContractId(tx, siteId)) === id) {
      throw new ConflictError(
        "Ce rattachement est porté par la fiche du site : retirez-le là-bas.",
      );
    }
    const removed = await repository.unlinkSite(tx, id, siteId);
    if (!removed) return;
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.site_unlinked",
      entityType: "contract",
      entityId: id,
      metadata: { number: contract.number, siteId },
    });
  });
}

export interface OverageConversion {
  changeRequestId: string;
  /** Renseigné si un devis brouillon existe pour ce travail. */
  quoteId: string | null;
}

/**
 * Travail hors forfait (09.04.02) : devient une demande de changement au niveau du client, par le
 * service des projets, et au besoin un devis brouillon par celui des devis. Une demande du même titre
 * encore vivante est reprise : renvoyer le formulaire ne crée pas de doublon.
 */
export async function convertOverage(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<OverageConversion> {
  assertCan(ctx.actor, "contracts:update");
  const data = parseInput(overageSchema, input);

  // Tout ou rien, sous le verrou du contrat : la demande, le devis et la note réussissent ensemble,
  // et deux envois simultanés ne font qu'une demande.
  return ctx.db.transaction(async (tx) => {
    const scoped: ServiceContext = { ...ctx, db: tx };
    const contract = await lockForWrite(tx, id);
    assertEditable(contract);

    const existing = await repository.findLiveChangeRequestByTitle(
      tx,
      contract.companyId,
      data.title,
    );
    const changeRequestId =
      existing?.id ??
      (
        await createChangeRequest(scoped, {
          companyId: contract.companyId,
          title: data.title,
          description: data.description,
          estimatedMinutes: data.estimatedMinutes,
          amountCents: data.amountCents,
        })
      ).id;

    const linkedQuoteId = existing?.quoteId ?? null;
    let quoteId = linkedQuoteId;
    if (data.withQuote && !quoteId) {
      const quote = await createQuote(scoped, { companyId: contract.companyId, title: data.title });
      await linkChangeRequestQuote(scoped, { changeRequestId, quoteId: quote.id });
      quoteId = quote.id;
    }

    if (!existing || quoteId !== linkedQuoteId) {
      await repository.insertEvent(tx, {
        contractId: id,
        kind: "note",
        note: quoteId
          ? `Hors forfait transformé en demande de changement et en devis : ${data.title}`
          : `Hors forfait transformé en demande de changement : ${data.title}`,
        actorId: ctx.actor.userId,
      });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "contract.updated",
        entityType: "contract",
        entityId: id,
        metadata: { number: contract.number, changeRequestId, quoteId },
      });
    }
    return { changeRequestId, quoteId };
  });
}

// --- Contrats entre modules (domain-model §6) --------------------------------------------------

export interface ResolveCoverageInput {
  companyId: string;
  siteId?: string | null;
  contractId?: string | null;
  category: TicketCategory;
  /** Date de calcul. Défaut : maintenant. */
  now?: Date;
}

/** Réponse à « cette demande est-elle couverte ? », à recopier dans `tickets.coverage`. */
export interface CoverageDecision {
  coverage: TicketCoverage;
  /** Contrat retenu ; NULL si aucun ne s'applique. */
  contractId: string | null;
  /** Explication en français, affichable telle quelle. */
  reason: string;
  /** Quota de la période ; NULL si le contrat n'en prévoit pas. */
  includedMinutes: number | null;
  consumedMinutes: number | null;
  includedTickets: number | null;
  consumedTickets: number | null;
}

function notCovered(reason: string, contractId: string | null = null): CoverageDecision {
  return {
    coverage: "not_covered",
    contractId,
    reason,
    includedMinutes: null,
    consumedMinutes: null,
    includedTickets: null,
    consumedTickets: null,
  };
}

/** Pourquoi ce contrat ne s'applique pas à cette date ; NULL s'il est en vigueur. */
function outOfForceReason(contract: Contract, today: string): string | null {
  const label = `Le contrat ${contract.number} (${contract.name})`;
  switch (contract.status) {
    case "to_start":
      return `${label} n'a pas encore démarré.`;
    case "suspended":
      return `${label} est suspendu.`;
    case "terminated":
      return `${label} est résilié.`;
    case "expired":
      return `${label} a expiré.`;
    default:
      if (contract.startOn && contract.startOn > today) {
        return `${label} ne démarre que le ${formatDateNumeric(contract.startOn)}.`;
      }
      if (contract.endOn && contract.endOn < today) {
        return `${label} a pris fin le ${formatDateNumeric(contract.endOn)}.`;
      }
      return null;
  }
}

function describeQuota(contract: Contract, consumption: ContractConsumption): string {
  const parts: string[] = [];
  if (consumption.includedMinutes !== null) {
    parts.push(
      `${formatMinutes(consumption.consumedMinutes)} sur ${formatMinutes(consumption.includedMinutes)}`,
    );
  }
  if (consumption.includedTickets !== null) {
    parts.push(`${consumption.consumedTickets} demande(s) sur ${consumption.includedTickets}`);
  }
  return parts.join(", ");
}

/**
 * Détermine la couverture d'une demande d'après les contrats du client et du site. Un contrat sans
 * site rattaché vaut pour tout le client ; avec des sites, pour ceux-là seulement. Si plusieurs
 * s'appliquent : couvert avant hors forfait, et un contrat qui nomme le site avant les autres.
 */
export async function resolveCoverage(
  db: Database,
  input: ResolveCoverageInput,
): Promise<CoverageDecision> {
  const data = parseInput(coverageInputSchema, {
    companyId: input.companyId,
    siteId: input.siteId,
    contractId: input.contractId,
    category: input.category,
  });
  const today = parisDay(input.now ?? new Date());

  const all = await repository.listCompanyCoverageCandidates(db, data.companyId);
  const candidates = data.contractId ? all.filter((row) => row.id === data.contractId) : all;
  if (candidates.length === 0) {
    return notCovered(
      data.contractId
        ? "Ce contrat n'appartient pas à ce client."
        : "Aucun contrat pour ce client.",
    );
  }

  const links = await repository.listSiteLinksForContracts(
    db,
    candidates.map((row) => row.id),
  );
  const sitesOf = (contractId: string) =>
    links.filter((link) => link.contractId === contractId).map((link) => link.siteId);

  const decisions: { decision: CoverageDecision; rank: number }[] = [];
  for (const contract of candidates) {
    const outOfForce = outOfForceReason(contract, today);
    if (outOfForce) {
      decisions.push({ decision: notCovered(outOfForce), rank: 0 });
      continue;
    }
    const linked = sitesOf(contract.id);
    const namesSite = Boolean(data.siteId && linked.includes(data.siteId));
    if (data.siteId && linked.length > 0 && !namesSite) {
      decisions.push({
        decision: notCovered(`Le contrat ${contract.number} ne couvre pas ce site.`),
        rank: 1,
      });
      continue;
    }
    if (!categoryCovered(contract.kind, data.category)) {
      const reason =
        data.category === "change"
          ? `Les évolutions ne sont pas incluses dans le contrat ${contract.number} : à transformer en demande de changement ou en devis.`
          : `${TICKET_CATEGORY_LABELS[data.category]} : non inclus dans un contrat de type ${CONTRACT_KIND_LABELS[contract.kind].toLocaleLowerCase("fr-FR")} (${contract.number}).`;
      decisions.push({ decision: notCovered(reason, contract.id), rank: 2 });
      continue;
    }

    const consumption = await readConsumption(db, contract, today);
    const figures = {
      contractId: contract.id,
      includedMinutes: consumption.includedMinutes,
      consumedMinutes: consumption.includedMinutes === null ? null : consumption.consumedMinutes,
      includedTickets: consumption.includedTickets,
      consumedTickets: consumption.includedTickets === null ? null : consumption.consumedTickets,
    };
    const quota = describeQuota(contract, consumption);
    if (quotaExhausted(consumption)) {
      decisions.push({
        decision: {
          ...figures,
          coverage: "overage",
          reason: `Forfait du contrat ${contract.number} épuisé sur la période du ${formatDateNumeric(consumption.periodStart)} : ${quota}.`,
        },
        rank: namesSite ? 4 : 3,
      });
      continue;
    }
    decisions.push({
      decision: {
        ...figures,
        coverage: "covered",
        reason: quota
          ? `Couvert par le contrat ${contract.number} (${contract.name}) : ${quota} sur la période.`
          : `Couvert par le contrat ${contract.number} (${contract.name}).`,
      },
      rank: namesSite ? 6 : 5,
    });
  }

  const best = decisions.reduce((top, item) => (item.rank > top.rank ? item : top));
  return best.decision;
}

export interface ConsumeContractQuotaInput {
  contractId: string;
  /**
   * Temps total du ticket sur la période (pas un incrément). Rappeler avec le même total ne change
   * rien, un total plus élevé remplace le précédent, un total plus bas est ignoré.
   * Sans ticket : une consommation de plus, à chaque appel.
   */
  minutes: number;
  /** NULL : consommation hors ticket (intervention planifiée). */
  ticketId: string | null;
  /** Auteur, s'il y en a un. NULL : action système. */
  actorId?: string | null;
  now?: Date;
}

/**
 * Impute une consommation au forfait et émet `contract.quota_80` ou `contract.quota_exceeded`, une
 * fois par période. Idempotent par ticket et par période : une seule ligne d'intervention pour un
 * ticket sur une période, une seule demande décomptée. À appeler dans la transaction de l'opération.
 */
export async function consumeContractQuota(
  tx: Database,
  input: ConsumeContractQuotaInput,
): Promise<void> {
  const data = parseInput(consumeQuotaSchema, {
    contractId: input.contractId,
    minutes: input.minutes,
    ticketId: input.ticketId,
  });
  const actorId = input.actorId ?? null;
  const today = parisDay(input.now ?? new Date());

  const contract = await repository.lockContract(tx, data.contractId);
  if (!contract) throw new NotFoundError("Contrat introuvable.");
  if (!["active", "to_review", "suspended"].includes(contract.status)) {
    throw new ConflictError(`Le contrat ${contract.number} n'est pas en vigueur.`);
  }

  const window = periodWindow(contract, today);

  if (data.ticketId) {
    const ticket = await repository.findTicketLabel(tx, data.ticketId, contract.companyId);
    if (!ticket) throw new NotFoundError("Demande introuvable pour ce client.");

    const existing = await repository.findTicketIntervention(tx, {
      contractId: contract.id,
      ticketId: data.ticketId,
      start: window.start,
      end: window.end,
    });
    if (existing?.doneOn) {
      if (data.minutes <= (existing.minutes ?? 0)) return;
      await repository.updateIntervention(tx, existing.id, { minutes: data.minutes });
    } else if (existing) {
      await repository.updateIntervention(tx, existing.id, {
        doneOn: today,
        minutes: data.minutes,
      });
    } else {
      await repository.insertIntervention(tx, {
        companyId: contract.companyId,
        contractId: contract.id,
        ticketId: data.ticketId,
        siteId: ticket.siteId,
        title: `Demande ${ticket.number} : ${ticket.subject}`,
        doneOn: today,
        minutes: data.minutes,
      });
    }
  } else {
    await repository.insertIntervention(tx, {
      companyId: contract.companyId,
      contractId: contract.id,
      title: "Consommation hors demande",
      doneOn: today,
      minutes: data.minutes,
    });
  }

  await recordAudit(tx, {
    actorId,
    action: "intervention.done",
    entityType: "contract",
    entityId: contract.id,
    metadata: { number: contract.number, minutes: data.minutes, ticketId: data.ticketId },
  });
  await emitQuotaEvents(tx, contract, today, actorId);
}

function billingAt(
  contract: repository.BillingCandidate,
  at: Date,
  day: string,
  suspensions: Map<string, Date>,
): boolean {
  if (contract.startOn && contract.startOn > day) return false;
  if (contract.endOn && contract.endOn < day) return false;
  if (contract.terminatedAt && contract.terminatedAt <= at) return false;
  if (contract.status === "expired" && !contract.endOn) return false;
  if (contract.status === "suspended") {
    const since = suspensions.get(contract.id);
    if (!since || since <= at) return false;
  }
  return true;
}

function emptyByKind<T>(make: () => T): Record<ContractKind, T> {
  return Object.fromEntries(CONTRACT_KINDS.map((kind) => [kind, make()])) as Record<
    ContractKind,
    T
  >;
}

/**
 * Source unique du MRR : prix des contrats en vigueur à `at`, ramenés au mois. Dans le passé, le prix
 * d'alors se lit dans l'historique. Un contrat suspendu puis repris compte sur toute la durée :
 * l'historique ne date pas la reprise. Sans contrôle d'accès : l'appelant a vérifié ses droits.
 */
export async function getRecurringRevenue(
  db: Database,
  input: { at?: Date } = {},
): Promise<RecurringRevenue> {
  const at = input.at ?? new Date();
  const on = parisDay(at);
  const candidates = await repository.listBillingCandidates(db, on);

  const [priceChanges, suspensions] = await Promise.all([
    repository.listPriceChangesAfter(db, at),
    repository.listLastSuspensions(
      db,
      candidates.filter((row) => row.status === "suspended").map((row) => row.id),
    ),
  ]);
  // Le premier changement après `at` dit le prix en vigueur à `at`.
  const priceThen = new Map<string, number>();
  for (const change of priceChanges) {
    if (!priceThen.has(change.contractId) && change.fromPriceCents !== null) {
      priceThen.set(change.contractId, change.fromPriceCents);
    }
  }

  const totals = emptyByKind(() => ({ count: 0, amount: 0 }));
  for (const contract of candidates) {
    if (!billingAt(contract, at, on, suspensions)) continue;
    const price = priceThen.get(contract.id) ?? contract.priceCents;
    totals[contract.kind].count += 1;
    totals[contract.kind].amount += monthlyAmountCents(price, contract.period);
  }

  const byKind = emptyByKind(() => ({ count: 0, mrrCents: 0 }));
  let amount = 0;
  let activeCount = 0;
  for (const kind of CONTRACT_KINDS) {
    amount += totals[kind].amount;
    activeCount += totals[kind].count;
    byKind[kind] = { count: totals[kind].count, mrrCents: Math.round(totals[kind].amount) };
  }
  const mrrCents = Math.round(amount);
  return { on, mrrCents, arrCents: Math.round(amount * 12), activeCount, byKind };
}

/** Contrats en vigueur dont l'échéance tombe dans la fenêtre (30 jours par défaut), retards compris. */
export async function listContractsDueForRenewal(
  db: Database,
  now: Date = new Date(),
  options: { withinDays?: number; limit?: number } = {},
): Promise<RenewalRow[]> {
  const until = addDays(parisDay(now), options.withinDays ?? RENEWAL_WINDOW_DAYS);
  return repository.listDueContracts(db, until, options.limit);
}

export async function getContractsSummary(
  db: Database,
  options: { now?: Date } = {},
): Promise<ContractsSummary> {
  const now = options.now ?? new Date();
  const today = parisDay(now);
  const [revenue, due, statuses, quotas] = await Promise.all([
    getRecurringRevenue(db, { at: now }),
    listContractsDueForRenewal(db, now),
    repository.countByStatus(db),
    listQuotaRows(db, today),
  ]);
  const activeByKind = emptyByKind(() => 0);
  for (const kind of CONTRACT_KINDS) activeByKind[kind] = revenue.byKind[kind].count;
  return {
    today,
    activeCount: revenue.activeCount,
    activeByKind,
    mrrCents: revenue.mrrCents,
    arrCents: revenue.arrCents,
    dueForRenewalCount: due.length,
    nextDue: due[0] ?? null,
    toStartCount: statuses.get("to_start") ?? 0,
    toReviewCount: statuses.get("to_review") ?? 0,
    averageQuotaPercent: averagePercent(quotas),
  };
}

const COMPANY_LIST_DEFAULT_LIMIT = 20;

/** Résumé pour la fiche client 360°. */
export async function listContractsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<CompanyContractRow[]> {
  assertCan(ctx.actor, "contracts:read");
  const rows = await repository.listCompanyContracts(
    ctx.db,
    companyId,
    options.limit ?? COMPANY_LIST_DEFAULT_LIMIT,
  );
  const consumptions = await readConsumptions(
    ctx.db,
    rows.map((row) => ({ ...row, id: row.id })),
    parisDay(options.now ?? new Date()),
  );
  return rows.map((row) => {
    const consumption = consumptions.get(row.id);
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      kind: row.kind,
      status: row.status,
      priceCents: row.priceCents,
      period: row.period,
      nextDueOn: row.nextDueOn,
      planName: row.planName,
      includedMinutes: row.includedMinutes,
      consumedMinutes: consumption?.consumedMinutes ?? 0,
      includedTickets: row.includedTickets,
      consumedTickets: consumption?.consumedTickets ?? 0,
    };
  });
}

/** Contrats rattachés à un site, pour sa fiche (écran 19, « Relations techniques »). */
export async function listContractsForSite(
  ctx: ServiceContext,
  siteId: string,
): Promise<ContractListRow[]> {
  assertCan(ctx.actor, "contracts:read");
  return repository.listSiteContracts(ctx.db, siteId);
}

/** Contrats du client connecté, pour le portail : ni coût, ni note interne, ni contrat à venir. */
export async function listContractsForPortal(
  ctx: PortalContext,
  options: { now?: Date } = {},
): Promise<PortalContractRow[]> {
  const contracts = (await repository.listCompanyCoverageCandidates(ctx.db, ctx.companyId)).filter(
    (row) => row.status === "active" || row.status === "to_review" || row.status === "suspended",
  );
  const today = parisDay(options.now ?? new Date());
  const consumptions = await readConsumptions(ctx.db, contracts, today);
  return Promise.all(
    contracts.map(async (contract) => {
      const sites = await repository.listLinkedSites(ctx.db, contract.id);
      const consumption = consumptions.get(contract.id);
      if (!consumption) throw new Error("Consommation introuvable.");
      return {
        id: contract.id,
        number: contract.number,
        name: contract.name,
        kind: contract.kind,
        status: contract.status,
        priceCents: contract.priceCents,
        period: contract.period,
        nextDueOn: nextDeadline(contract),
        scope: contract.scope,
        exclusions: contract.exclusions,
        responseHours: contract.responseHours,
        resolutionHours: contract.resolutionHours,
        sites: sites.map(({ siteId, name, primaryDomain }) => ({ siteId, name, primaryDomain })),
        consumption,
      };
    }),
  );
}

/**
 * Parcours 2 : à la mise en ligne d'un site, ses contrats à démarrer démarrent. Idempotent : un
 * contrat déjà démarré n'est plus concerné. À appeler dans la transaction de la mise en ligne.
 */
export async function activateContractsForSite(
  tx: Database,
  input: { siteId: string; actorId: string | null; now?: Date },
): Promise<void> {
  const today = parisDay(input.now ?? new Date());
  const contracts = await repository.listToStartContractsForSite(tx, input.siteId);
  for (const contract of contracts) {
    await applyStatusChange(tx, contract, "active", {
      note: "Contrat démarré à la mise en ligne du site.",
      actorId: input.actorId,
      today,
    });
  }
}

export interface ContractDeadlinesResult {
  renewed: number;
  expired: number;
  alerted: number;
  /** Contrats en échec : annulés et journalisés, la tâche passe au suivant et les reprend demain. */
  failed: number;
}

/**
 * Tâche planifiée quotidienne (08.04.01). Renouvelle les contrats à renouvellement automatique, fait
 * expirer ceux dont la fin est passée et émet `contract.expiring` une fois par échéance. Relancer le
 * même jour ne refait rien.
 */
export async function runContractDeadlines(
  db: Database,
  options: { now?: Date } = {},
): Promise<ContractDeadlinesResult> {
  const now = options.now ?? new Date();
  const today = parisDay(now);
  const horizon = addDays(today, RENEWAL_WINDOW_DAYS);
  const contracts = await repository.listContractsForSweep(db, horizon);
  const result: ContractDeadlinesResult = { renewed: 0, expired: 0, alerted: 0, failed: 0 };

  for (const { id } of contracts) {
    // Un compte par contrat : il ne rejoint le total qu'une fois sa transaction validée.
    const counted = { renewed: 0, expired: 0, alerted: 0 };
    try {
      await db.transaction(async (tx) => {
        let contract = await repository.lockContract(tx, id);
        // Relu sous verrou : il a pu être suspendu ou résilié depuis le début de la tâche.
        if (!contract || !repository.IN_FORCE_STATUSES.includes(contract.status)) return;

        while (contract.autoRenew && contract.renewsOn && contract.renewsOn <= today) {
          contract = await applyRenewal(tx, contract, {
            newNextOn: addBillingPeriod(contract.renewsOn, contract.period),
            note: "Renouvellement automatique.",
            actorId: null,
          });
          counted.renewed += 1;
        }

        if (contract.status === "active" && contract.endOn && contract.endOn < today) {
          await applyStatusChange(tx, contract, "expired", {
            note: null,
            actorId: null,
            today,
          });
          counted.expired += 1;
          return;
        }

        // La plus proche des deux dates : une fin avant le renouvellement ne passe pas inaperçue.
        const due = earliest(contract.renewsOn, contract.endOn);
        if (due && due <= horizon && !(contract.autoRenew && contract.renewsOn)) {
          await emitEvent(tx, {
            type: "contract.expiring",
            entityType: "contract",
            entityId: contract.id,
            companyId: contract.companyId,
            payload: {
              number: contract.number,
              renewsOn: contract.renewsOn,
              endOn: contract.endOn,
            },
            actorId: null,
            dedupeKey: `contract.expiring:${contract.id}:${due}`,
          });
          counted.alerted += 1;
        }
      });
      result.renewed += counted.renewed;
      result.expired += counted.expired;
      result.alerted += counted.alerted;
    } catch (error) {
      result.failed += 1;
      logger.error("contract.deadline_failed", { contractId: id, error });
    }
  }
  return result;
}
