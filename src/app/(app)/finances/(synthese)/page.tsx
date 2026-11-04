import type { Metadata } from "next";
import Link from "next/link";
import { StackedBars } from "@/components/charts/stacked-bars";
import { PageHeader } from "@/components/layout/page-header";
import { RollingNumber } from "@/components/motion/rolling-number";
import { EmptyState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { ButtonExternalLink } from "@/components/ui/button";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Gauge } from "@/components/ui/gauge";
import { InfoCard } from "@/components/ui/info-card";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { Tile } from "@/components/ui/tile";
import { INTEGRATION_STATUS_LABELS } from "@/lib/domain-enums";
import { formatDateShort, formatPercent, formatRelativeDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { paramValue } from "@/lib/url-state";
import { AmountRows } from "@/modules/finance/components/amount-rows";
import { ExportMenu, InvoiceToolbar } from "@/modules/finance/components/finance-actions";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import { euroFormat, firstName, marginTone } from "@/modules/finance/components/finance-format";
import { InvoiceTable } from "@/modules/finance/components/invoice-table";
import { MarginTable } from "@/modules/finance/components/margin-table";
import {
  getFinanceFormOptions,
  getFinanceOverview,
  listInvoices,
  type FinanceMonth,
} from "@/modules/finance/finance.service";
import { daysBetween, parisDay } from "@/modules/finance/finance.dates";
import { getProfitabilityOverview } from "@/modules/finance/profitability.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Finances et rentabilité" };

const STATUS_FILTERS = new Set(["issued", "overdue", "paid", "cancelled"]);

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count > 1 ? many : one}`;

/** Deux séries au plus sur le graphique : les deux émetteurs principaux, puis le reste regroupé. */
function monthlySeries(months: readonly FinanceMonth[]) {
  const totals = new Map<string, number>();
  for (const month of months) {
    for (const row of month.byIssuer) totals.set(row.name, (totals.get(row.name) ?? 0) + row.cents);
  }
  const names = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const first = names[0];
  const second = names[1];
  const others = names.slice(2);
  const valuesFor = (keep: (name: string) => boolean) =>
    months.map(
      (month) =>
        month.byIssuer.filter((row) => keep(row.name)).reduce((sum, row) => sum + row.cents, 0) /
        100,
    );
  const series = [];
  if (first) {
    series.push({
      key: "first",
      label: firstName(first),
      values: valuesFor((name) => name === first),
    });
  }
  if (second) {
    series.push({
      key: "second",
      label: others.length > 0 ? "Autres associés" : firstName(second),
      values: valuesFor((name) => name === second || others.includes(name)),
    });
  }
  return series;
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const params = await searchParams;
  const statusParam = paramValue(params, "etat");
  const status = statusParam && STATUS_FILTERS.has(statusParam) ? statusParam : null;
  const search = paramValue(params, "q") ?? null;

  const [overview, profitability, invoices, formOptions] = await Promise.all([
    getFinanceOverview(ctx),
    getProfitabilityOverview(ctx),
    listInvoices(
      ctx,
      { status, search },
      parsePagination({ page: paramValue(params, "page"), pageSize: 8 }),
    ),
    getFinanceFormOptions(ctx),
  ]);
  const { summary, upcoming, overdue, recurring, connection } = overview;
  const today = parisDay(new Date());
  const canManage = can(ctx.actor, "finance:manage");

  const series = monthlySeries(summary.months);
  const hasCollected = summary.months.some((month) => month.collectedCents > 0);

  const lastImport = summary.lastImportAt
    ? `dernier import ${formatRelativeDate(summary.lastImportAt)}`
    : "aucun import";
  const subtitle =
    summary.documentCount > 0
      ? `Les factures officielles restent dans Indy · Nuera OS lit leurs ${summary.documentCount} références et leurs états · ${lastImport}`
      : "Les factures officielles restent dans Indy · Nuera OS lit leurs références et leurs états · aucune référence pour l'instant";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Finances et rentabilité"
        subtitle={subtitle}
        className="mb-0! lg:mb-0!"
        actions={
          <>
            <ButtonExternalLink href={connection.appUrl}>Ouvrir Indy</ButtonExternalLink>
            <ExportMenu />
          </>
        }
      />

      <KpiGrid>
        <KpiCard
          label="Encaissé ce mois"
          value={
            <RollingNumber
              value={summary.collectedCents / 100}
              format={euroFormat(summary.collectedCents)}
            />
          }
          note={
            summary.maxInvoicesPerScheduleItem > 1
              ? `${summary.maxInvoicesPerScheduleItem} factures par échéance (co-traitance)`
              : summary.collectedDocuments > 0
                ? plural(summary.collectedDocuments, "facture encaissée", "factures encaissées")
                : "aucun encaissement ce mois"
          }
          noteTone={summary.maxInvoicesPerScheduleItem > 1 ? "success" : "muted"}
        />
        <KpiCard
          label="À encaisser"
          value={
            <RollingNumber
              value={summary.outstandingCents / 100}
              format={euroFormat(summary.outstandingCents)}
            />
          }
          note={`${plural(summary.outstandingCount, "facture")} · ${plural(summary.plannedScheduleCount, "échéance")} à venir`}
          href="/finances?etat=issued"
        />
        <KpiCard
          label="En retard"
          value={
            <RollingNumber
              value={summary.overdueCents / 100}
              format={euroFormat(summary.overdueCents)}
            />
          }
          note={
            summary.overdueCount > 0
              ? `${plural(summary.overdueCount, "facture")} à relancer`
              : "aucune relance"
          }
          noteTone={summary.overdueCount > 0 ? "danger" : "muted"}
          href={summary.overdueCount > 0 ? "/finances?etat=overdue" : undefined}
        />
        <KpiCard
          label="Marge réelle moyenne"
          value={
            profitability.average.percent === null ? (
              "—"
            ) : (
              <RollingNumber value={Math.round(profitability.average.percent)} suffix=" %" />
            )
          }
          note={
            profitability.average.percent === null
              ? "aucune facture rattachée à un projet"
              : "après temps et coûts"
          }
          href="/finances/rentabilite"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <FilterBar
                searchParam="q"
                searchPlaceholder="Référence, client, projet…"
                label="Filtrer par état"
              >
                <FilterChip param="etat">Toutes</FilterChip>
                <FilterChip param="etat" value="issued">
                  Envoyées
                </FilterChip>
                <FilterChip param="etat" value="overdue">
                  En retard
                </FilterChip>
                <FilterChip param="etat" value="paid">
                  Payées
                </FilterChip>
                <FilterChip param="etat" value="cancelled">
                  Annulées
                </FilterChip>
              </FilterBar>
              {canManage ? (
                <div className="ml-auto">
                  <InvoiceToolbar options={formOptions} />
                </div>
              ) : null}
            </div>
            <InvoiceTable
              rows={invoices.items}
              query={{ pathname: "/finances", searchParams: params }}
              pagination={invoices}
              empty={
                <EmptyState
                  compact
                  icon="euro"
                  title={
                    status || search ? "Aucune facture pour ce filtre" : "Aucune facture référencée"
                  }
                  description="Importez votre fichier Indy ou saisissez une référence : le revenu réel des projets en dépend."
                />
              }
            />
          </div>

          <div className="flex flex-col gap-3">
            <MarginTable
              rows={profitability.projects}
              scope="project"
              firstHeader="Projet"
              caption="Rentabilité par projet"
            />
            <div className="flex justify-end">
              <Link
                href="/finances/rentabilite"
                className="hit-44 text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                Toute la rentabilité : {plural(profitability.projectTotal, "projet")}, clients,
                sites, contrats
              </Link>
            </div>
          </div>

          <Tile icon="euro" title="Encaissé par mois" className="rounded-lg p-6">
            {hasCollected ? (
              <StackedBars
                title="Encaissé par mois et par associé"
                summary={`Encaissements HT des 6 derniers mois, ${summary.months.at(-1)?.longLabel} compris.`}
                points={summary.months.map((month) => ({
                  label: month.label,
                  tooltipLabel: month.longLabel.toLocaleUpperCase("fr-FR"),
                }))}
                series={series}
                valueFormat={{
                  format: { style: "currency", currency: "EUR", maximumFractionDigits: 0 },
                }}
              />
            ) : (
              <EmptyState
                compact
                icon="euro"
                title="Aucun encaissement sur 6 mois"
                description="Les factures marquées payées s'affichent ici, avec la part de chaque associé."
              />
            )}
          </Tile>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {overdue.length > 0 ? (
            <InfoCard
              icon="alert"
              title="Retards de paiement"
              aside={
                <Badge tone="danger">
                  {plural(summary.overdueCount, "à relancer", "à relancer")}
                </Badge>
              }
            >
              <AmountRows
                rows={overdue.map((invoice) => ({
                  key: invoice.id,
                  label: (
                    <Link
                      href={`/finances/factures/${invoice.id}`}
                      className="hover:underline hover:underline-offset-4"
                    >
                      {invoice.externalRef ?? "Sans référence"} · {invoice.companyName}
                      {invoice.dueOn ? ` · ${daysBetween(invoice.dueOn, today)} j` : ""}
                    </Link>
                  ),
                  value: formatCents(invoice.amountCents),
                }))}
              />
              <p className="text-xs text-muted">
                La relance part d&apos;Indy, qui garde la facture.
              </p>
              {summary.overdueCount > overdue.length ? (
                <Link
                  href="/finances?etat=overdue"
                  className="hit-44 w-fit text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  Voir tous les retards
                </Link>
              ) : null}
            </InfoCard>
          ) : null}

          <InfoCard icon="clock" title="Échéancier">
            <AmountRows
              rows={upcoming.map((item) => ({
                key: item.id,
                label: (
                  <Link
                    href={`/finances/echeancier/${item.id}`}
                    className="hover:underline hover:underline-offset-4"
                  >
                    {item.dueOn ? `${formatDateShort(item.dueOn)} · ` : ""}
                    {item.label} · {item.companyName}
                  </Link>
                ),
                value: formatCents(item.amountCents),
              }))}
            />
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">Aucune échéance à venir.</p>
            ) : null}
            <Link
              href="/finances/echeancier"
              className="hit-44 w-fit text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              Voir tout l&apos;échéancier
            </Link>
          </InfoCard>

          <InfoCard icon="server" title="Coûts récurrents">
            <AmountRows
              rows={recurring.lines.slice(0, 5).map((line) => ({
                key: line.id,
                label: line.contractName ? `${line.label} · ${line.contractName}` : line.label,
                value:
                  line.monthlyCents === null
                    ? "à chiffrer"
                    : `≈ ${formatCents(line.monthlyCents)}/mois`,
              }))}
            />
            {recurring.lines.length === 0 ? (
              <p className="text-sm text-muted">Aucun coût récurrent enregistré.</p>
            ) : null}
            <p className="text-xs text-muted">
              Un abonnement est déficitaire si ses coûts dépassent son prix :{" "}
              {recurring.subscriptionsChecked === 0
                ? "aucun abonnement en cours."
                : recurring.deficits.length === 0
                  ? "aucun aujourd'hui."
                  : `${plural(recurring.deficits.length, "abonnement")} aujourd'hui.`}
              {recurring.subscriptionsWithoutCost > 0
                ? ` ${plural(recurring.subscriptionsWithoutCost, "abonnement")} sans coût renseigné.`
                : ""}
            </p>
            {recurring.deficits.length > 0 ? (
              <AmountRows
                rows={recurring.deficits.slice(0, 3).map((deficit) => ({
                  key: deficit.contractId,
                  label: (
                    <Link
                      href={`/finances/rentabilite/contract/${deficit.contractId}`}
                      className="hover:underline hover:underline-offset-4"
                    >
                      {deficit.companyName} · {deficit.name}
                    </Link>
                  ),
                  value: <Badge tone="danger">−{formatCents(deficit.deficitCents)}/mois</Badge>,
                }))}
              />
            ) : null}
            <Link
              href="/finances/couts"
              className="hit-44 w-fit text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              Voir tous les coûts
            </Link>
          </InfoCard>

          <InfoCard icon="chart" title="Rentabilité client">
            {profitability.clients.length === 0 ? (
              <p className="text-sm text-muted">
                Indisponible tant qu&apos;aucune facture n&apos;est rattachée à un client.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {profitability.clients.map((client, index) => {
                  const percent = client.margin.actual.marginPercent ?? 0;
                  return (
                    <li key={client.id}>
                      <Link
                        href={`/finances/rentabilite/client/${client.id}`}
                        className="flex flex-col gap-1.5 text-sm text-text hover:underline hover:underline-offset-4"
                      >
                        {client.title}
                        <Gauge
                          value={Math.max(0, percent)}
                          tone={marginTone(percent)}
                          height={5}
                          index={index}
                          label={`Marge réelle de ${client.title}`}
                          valueText={formatPercent(percent)}
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </InfoCard>

          <InfoCard
            icon="wallet"
            title="Revenus à venir"
            rows={[
              {
                key: "mrr",
                label: `Récurrent · ${plural(summary.runningContracts, "contrat")}`,
                value: `${formatCents(summary.mrrCents)}/mois`,
              },
              {
                key: "certain",
                label: "Certain · factures et échéances",
                value: formatCents(
                  summary.outstandingCents + summary.overdueCents + summary.plannedScheduleCents,
                ),
              },
              {
                key: "forecast",
                label: `Prévisionnel · ${plural(summary.openQuotesCount, "devis", "devis")} envoyés`,
                value: formatCents(summary.openQuotesCents),
              },
            ]}
          >
            <p className="text-xs text-muted">
              Le certain et le prévisionnel ne s&apos;additionnent jamais.
            </p>
          </InfoCard>

          <InfoCard
            icon="link"
            title="Indy"
            aside={
              <Badge tone={connection.status === "connected" ? "success" : "warn"}>
                {INTEGRATION_STATUS_LABELS[connection.status]}
              </Badge>
            }
            rows={[
              {
                key: "last",
                label: "Dernier import",
                value: summary.lastImportAt ? formatRelativeDate(summary.lastImportAt) : "aucun",
              },
            ]}
          >
            <p className="text-xs text-muted">
              Indy ne documente pas d&apos;API publique : ni lecture ni écriture automatique. Les
              références arrivent par fichier CSV ou par saisie, et les états datent de ce dernier
              import.
            </p>
            <Link
              href="/finances/imports"
              className="hit-44 w-fit text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              Historique des imports
            </Link>
          </InfoCard>
        </aside>
      </div>
    </div>
  );
}
