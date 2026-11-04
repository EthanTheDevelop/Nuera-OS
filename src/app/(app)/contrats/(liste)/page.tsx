import Link from "next/link";
import { RollingNumber } from "@/components/motion/rolling-number";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import {
  CellIdentity,
  DataTable,
  SORT_DIRECTION_PARAM,
  SORT_PARAM,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { InfoCard } from "@/components/ui/info-card";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { CONTRACT_KIND_LABELS } from "@/lib/domain-enums";
import { formatDateNumeric, formatDateShort } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { paramValue, type SearchParamsLike } from "@/lib/url-state";
import { NewContractButton } from "@/modules/contracts/components/contract-form";
import { KindFilter } from "@/modules/contracts/components/kind-filter";
import { hasMeasurableQuota, QuotaGauges } from "@/modules/contracts/components/quota-gauges";
import {
  contractTypeLabel,
  describeKinds,
  describeQuota,
  formatDeadline,
  periodLabel,
} from "@/modules/contracts/contract.format";
import { addDays, RENEWAL_WINDOW_DAYS } from "@/modules/contracts/contract.rules";
import type { ContractListFilter } from "@/modules/contracts/contract.schema";
import {
  getContractFormOptions,
  getContractsOverview,
  listContracts,
  type ContractFormOptions,
} from "@/modules/contracts/contract.service";
import type { ContractListRow, ContractsSummary } from "@/modules/contracts/contract.types";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata = { title: "Contrats et abonnements" };

const TITLE = "Contrats et abonnements";
const ROWS_PER_PAGE = 25;

const FILTERS: Record<string, ContractListFilter> = {
  actifs: "active",
  "a-revoir": "to_review",
  "a-demarrer": "to_start",
  suspendus: "suspended",
  termines: "ended",
  tous: "all",
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** « 3 contrats actifs · 1 398 € par mois · 1 renouvellement dans 30 jours ». */
function summarize(summary: ContractsSummary): string {
  return [
    plural(summary.activeCount, "contrat actif", "contrats actifs"),
    `${formatCents(Math.round(summary.mrrCents / 100) * 100)} par mois`,
    summary.dueForRenewalCount > 0
      ? `${plural(summary.dueForRenewalCount, "renouvellement")} dans ${RENEWAL_WINDOW_DAYS} jours`
      : `aucun renouvellement dans ${RENEWAL_WINDOW_DAYS} jours`,
  ].join(" · ");
}

function columns(today: string): DataTableColumn<ContractListRow>[] {
  return [
    {
      key: "contract",
      header: "Contrat",
      primary: true,
      sortable: true,
      cell: (row) => <CellIdentity title={row.companyName} />,
    },
    {
      key: "type",
      header: "Type",
      width: 186,
      cell: (row) => (
        <span
          className="block truncate"
          title={`${CONTRACT_KIND_LABELS[row.kind]} · ${row.number}`}
        >
          {contractTypeLabel(row.name, row.companyName, row.kind)}
        </span>
      ),
    },
    {
      key: "price",
      header: "Prix",
      width: 136,
      sortable: true,
      cell: (row) => <span className="tabular">{formatCents(row.priceCents)}</span>,
    },
    {
      key: "period",
      header: "Périodicité",
      width: 126,
      cell: (row) => periodLabel(row.period),
    },
    {
      key: "deadline",
      header: "Prochaine échéance",
      width: 158,
      sortable: true,
      cell: (row) => {
        if (row.status === "terminated" || row.status === "expired") return "—";
        if (row.nextDueOn) return formatDeadline(row.nextDueOn, today);
        return row.awaitsGoLive ? "dès la mise en ligne" : "—";
      },
    },
    {
      key: "status",
      header: "État",
      width: 128,
      cell: (row) => <StatusBadge kind="contract" status={row.status} />,
    },
  ];
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "contracts:read")) {
    return (
      <>
        <PageHeader title={TITLE} />
        <ForbiddenState />
      </>
    );
  }

  const params: SearchParamsLike = await searchParams;
  const search = paramValue(params, "q");
  const filterKey = paramValue(params, "filtre");
  const kind = paramValue(params, "type");
  const pagination = parsePagination(
    { page: paramValue(params, "page") },
    { defaultPageSize: ROWS_PER_PAGE },
  );
  const canCreate = can(ctx.actor, "contracts:create");

  const [overview, contracts, formOptions] = await Promise.all([
    getContractsOverview(ctx),
    listContracts(
      ctx,
      {
        search,
        filter: filterKey ? FILTERS[filterKey] : undefined,
        kind,
        sort: paramValue(params, SORT_PARAM),
        direction: paramValue(params, SORT_DIRECTION_PARAM),
      },
      pagination,
    ),
    canCreate ? getContractFormOptions(ctx) : Promise.resolve<ContractFormOptions | null>(null),
  ]);

  const { summary, quotas, recentInterventions, renewals, priceReviews, domains } = overview;
  const today = summary.today;
  const filtered = Boolean(search || filterKey || kind);
  const measuredQuotas = quotas.filter(hasMeasurableQuota);
  const conditionsNote = renewals.find((row) => row.conditions)?.conditions ?? null;
  const panelEmpty =
    renewals.length === 0 && priceReviews.length === 0 && (domains ?? []).length === 0;
  const alertUntil = addDays(today, RENEWAL_WINDOW_DAYS);

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        title={TITLE}
        subtitle={summarize(summary)}
        actions={
          <>
            <ButtonLink href="/contrats/formules">Formules</ButtonLink>
            {formOptions ? (
              <NewContractButton
                companies={formOptions.companies}
                plans={formOptions.plans}
                quotes={formOptions.quotes}
                canReadCosts={formOptions.canReadCosts}
                defaultOpen={paramValue(params, "nouveau") === "1"}
                defaultCompanyId={paramValue(params, "client")}
                defaultQuoteId={paramValue(params, "devis")}
              />
            ) : null}
          </>
        }
      />

      <KpiGrid>
        <KpiCard
          label="Revenus récurrents"
          value={
            <RollingNumber
              value={summary.mrrCents / 100}
              format={{ style: "currency", currency: "EUR", maximumFractionDigits: 0 }}
              suffix="/mois"
            />
          }
          note={`${formatCents(summary.arrCents)} sur 12 mois`}
          noteTone={summary.mrrCents > 0 ? "success" : "muted"}
        />
        <KpiCard
          label="Contrats actifs"
          value={<RollingNumber value={summary.activeCount} />}
          note={describeKinds(summary.activeByKind) || "aucun contrat en vigueur"}
        />
        <KpiCard
          label={`À renouveler (${RENEWAL_WINDOW_DAYS} j)`}
          value={<RollingNumber value={summary.dueForRenewalCount} />}
          note={
            summary.nextDue
              ? `${summary.nextDue.companyName} · ${contractTypeLabel(summary.nextDue.contractName, summary.nextDue.companyName, summary.nextDue.kind)}`
              : "aucune échéance proche"
          }
          noteTone={summary.nextDue ? "warn" : "muted"}
          href={summary.nextDue ? `/contrats/${summary.nextDue.contractId}` : undefined}
        />
        <KpiCard
          label="Forfaits consommés"
          value={
            summary.averageQuotaPercent === null ? (
              "—"
            ) : (
              <RollingNumber value={Math.round(summary.averageQuotaPercent)} suffix=" %" />
            )
          }
          note={summary.averageQuotaPercent === null ? "aucun forfait en cours" : "moyenne du mois"}
        />
      </KpiGrid>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <FilterBar
            className="max-w-full min-w-0"
            searchParam="q"
            searchPlaceholder="Client, contrat, numéro…"
            label="Filtrer par état"
          >
            <FilterChip param="filtre">En cours</FilterChip>
            <FilterChip param="filtre" value="actifs">
              Actifs
            </FilterChip>
            <FilterChip param="filtre" value="a-revoir">
              À revoir
            </FilterChip>
            <FilterChip param="filtre" value="a-demarrer">
              À démarrer
            </FilterChip>
            <FilterChip param="filtre" value="suspendus">
              Suspendus
            </FilterChip>
            <FilterChip param="filtre" value="termines">
              Terminés
            </FilterChip>
            <FilterChip param="filtre" value="tous">
              Tous
            </FilterChip>
          </FilterBar>
          <KindFilter param="type" />
        </div>

        <DataTable
          caption="Contrats et abonnements"
          columns={columns(today)}
          rows={contracts.items}
          rowKey={(row) => row.id}
          rowHref={(row) => `/contrats/${row.id}`}
          query={{ pathname: "/contrats", searchParams: params }}
          pagination={
            contracts.total > contracts.pageSize
              ? { page: contracts.page, pageSize: contracts.pageSize, total: contracts.total }
              : undefined
          }
          empty={
            filtered ? (
              <EmptyState
                icon="search"
                title="Aucun contrat ne correspond"
                description="Modifiez la recherche ou les filtres."
              />
            ) : (
              <EmptyState
                icon="contrat"
                title="Aucun contrat en cours"
                description="Un contrat rattache un client, ses sites, un prix récurrent et ce qui est inclus."
              />
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard icon="clock" title="Consommation des forfaits">
            {measuredQuotas.length === 0 ? (
              <p className="text-sm text-muted">Aucun contrat en vigueur ne prévoit de quota.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {measuredQuotas.map((row, position) => {
                  const label = `${row.companyName} · ${describeQuota(row.includedMinutes, row.includedTickets, row.kind, row.period)}`;
                  return (
                    <li key={row.contractId}>
                      <Link
                        href={`/contrats/${row.contractId}`}
                        className="flex flex-col gap-3 rounded-sm hover:[&_span]:text-ink"
                      >
                        <QuotaGauges
                          consumption={row}
                          minutesLabel={label}
                          ticketsLabel={
                            row.includedMinutes ? `${row.companyName} · demandes` : label
                          }
                          index={position}
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </InfoCard>

          <InfoCard icon="check" title="Journal de maintenance">
            {recentInterventions.length === 0 ? (
              <p className="text-sm text-muted">Aucune intervention réalisée pour le moment.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentInterventions.map((row) => (
                  <li key={row.id} className="flex items-baseline gap-3 text-sm text-text">
                    <span className="w-14 shrink-0 font-mono text-amount-compact text-muted">
                      {row.doneOn ? formatDateShort(row.doneOn) : "—"}
                    </span>
                    <Link
                      href={`/contrats/${row.contractId}`}
                      className="hit-44 min-w-0 hover:underline hover:underline-offset-4"
                    >
                      {row.title} · {row.companyName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </InfoCard>
        </div>

        <InfoCard icon="calendar" title="Renouvellements et révisions">
          {panelEmpty ? (
            <p className="text-sm text-muted">Aucune échéance dans les 90 prochains jours.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {renewals.map((row) => (
                <li
                  key={`renewal-${row.contractId}`}
                  className="flex items-center justify-between gap-3 text-sm text-text"
                >
                  <Link
                    href={`/contrats/${row.contractId}`}
                    className="min-w-0 hover:underline hover:underline-offset-4"
                  >
                    {row.companyName} ·{" "}
                    {contractTypeLabel(row.contractName, row.companyName, row.kind)}
                  </Link>
                  <Badge tone={row.dueOn <= alertUntil ? "warn" : "neutral"} className="shrink-0">
                    {formatDeadline(row.dueOn, today)}
                  </Badge>
                </li>
              ))}
              {(domains ?? []).map((row) => (
                <li
                  key={`domain-${row.name}`}
                  className="flex items-center justify-between gap-3 text-sm text-text"
                >
                  <span className="min-w-0 break-words">Domaine {row.name}</span>
                  <span className="tabular shrink-0 pr-2 text-muted">
                    {formatDateNumeric(row.expiresOn)}
                  </span>
                </li>
              ))}
              {priceReviews.map((row) => (
                <li
                  key={`review-${row.contractId}`}
                  className="flex items-center justify-between gap-3 text-sm text-text"
                >
                  <Link
                    href={`/contrats/${row.contractId}`}
                    className="min-w-0 hover:underline hover:underline-offset-4"
                  >
                    Tarif {CONTRACT_KIND_LABELS[row.kind].toLocaleLowerCase("fr-FR")}{" "}
                    {formatCents(row.priceCents)} · {row.companyName}
                  </Link>
                  {row.reviewOn <= today || row.status === "to_review" ? (
                    <Badge tone="warn" className="shrink-0">
                      à revoir
                    </Badge>
                  ) : (
                    <span className="tabular shrink-0 pr-2 text-muted">
                      à revoir en {row.reviewOn.slice(0, 4)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {conditionsNote ? (
            <p className="line-clamp-3 text-kpi-note text-muted">{conditionsNote}</p>
          ) : null}
        </InfoCard>
      </div>
    </div>
  );
}
