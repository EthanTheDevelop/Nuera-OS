import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states/states";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { InfoCard } from "@/components/ui/info-card";
import {
  BILLING_PERIOD_LABELS,
  COST_CATEGORIES,
  COST_CATEGORY_LABELS,
  COST_NATURE_LABELS,
} from "@/lib/domain-enums";
import { formatDateNumeric } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { paramValue } from "@/lib/url-state";
import { AmountRows } from "@/modules/finance/components/amount-rows";
import { CostRowActions, NewCostButton } from "@/modules/finance/components/finance-actions";
import { FinanceForbidden } from "@/modules/finance/components/finance-forbidden";
import {
  getFinanceFormOptions,
  getRecurringOverview,
  listDirectCosts,
} from "@/modules/finance/finance.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Coûts directs" };

const NATURES = new Set(["forecast", "actual"]);
const CATEGORIES = new Set<string>(COST_CATEGORIES);

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "finance:read")) return <FinanceForbidden />;

  const params = await searchParams;
  const natureParam = paramValue(params, "nature");
  const nature = natureParam && NATURES.has(natureParam) ? natureParam : null;
  const typeParam = paramValue(params, "type");
  const recurring = typeParam === "recurrent" ? "yes" : null;
  const category = typeParam && CATEGORIES.has(typeParam) ? typeParam : null;
  const search = paramValue(params, "q") ?? null;
  const canManage = can(ctx.actor, "finance:manage");

  const [page, options, overview] = await Promise.all([
    listDirectCosts(
      ctx,
      { nature, category, recurring, search },
      parsePagination({ page: paramValue(params, "page") }),
    ),
    getFinanceFormOptions(ctx),
    getRecurringOverview(ctx),
  ]);
  const monthly = `récurrents ≈ ${formatCents(overview.monthlyTotalCents)}/mois${
    overview.toQuantifyCount > 0 ? `, ${overview.toQuantifyCount} à chiffrer` : ""
  }`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Finances", href: "/finances" }, { label: "Coûts" }]}
        title="Coûts directs et récurrents"
        subtitle={`${page.total} coût${page.total > 1 ? "s" : ""} · ${monthly} · le prévisionnel et le réalisé restent séparés`}
        actions={canManage ? <NewCostButton options={options} /> : null}
      >
        <FilterBar
          searchParam="q"
          searchPlaceholder="Coût, client, projet…"
          label="Filtrer par nature"
        >
          <FilterChip param="nature">Tous</FilterChip>
          <FilterChip param="nature" value="actual">
            Réalisés
          </FilterChip>
          <FilterChip param="nature" value="forecast">
            Prévisionnels
          </FilterChip>
        </FilterBar>
        <FilterBar label="Filtrer par type">
          <FilterChip param="type">Tous les types</FilterChip>
          <FilterChip param="type" value="recurrent">
            Récurrents
          </FilterChip>
          {COST_CATEGORIES.map((value) => (
            <FilterChip key={value} param="type" value={value}>
              {COST_CATEGORY_LABELS[value]}
            </FilterChip>
          ))}
        </FilterBar>
      </PageHeader>

      {overview.deficits.length > 0 ? (
        <InfoCard icon="server" title="Abonnements déficitaires" className="mb-6">
          <AmountRows
            rows={overview.deficits.map((deficit) => ({
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
        </InfoCard>
      ) : null}

      <DataTable
        caption="Coûts directs"
        rows={page.items}
        rowKey={(row) => row.id}
        query={{ pathname: "/finances/couts", searchParams: params }}
        pagination={page}
        empty={
          <EmptyState
            compact
            icon="wallet"
            title={
              nature || recurring || category || search ? "Aucun coût pour ce filtre" : "Aucun coût"
            }
            description="Ajoutez les achats et la sous-traitance : la marge réelle en dépend."
          />
        }
        columns={[
          {
            key: "label",
            header: "Coût",
            primary: true,
            cell: (row) => (
              <span className="block truncate text-row-primary text-ink">{row.label}</span>
            ),
          },
          {
            key: "object",
            header: "Rattaché à",
            cell: (row) => (
              <span className="block truncate">
                {[row.companyName, row.projectName ?? row.contractName ?? row.siteName]
                  .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
                  .join(" · ") || "Frais de l'agence"}
              </span>
            ),
          },
          {
            key: "category",
            header: "Catégorie",
            width: 120,
            hideWhenCollapsed: true,
            cell: (row) => COST_CATEGORY_LABELS[row.category],
          },
          {
            key: "date",
            header: "Date",
            width: 100,
            cell: (row) => <span className="tabular">{formatDateNumeric(row.incurredOn)}</span>,
          },
          {
            key: "amount",
            header: "Montant",
            width: 140,
            cell: (row) => (
              <span className="tabular">
                {row.amountCents === 0 ? "à chiffrer" : formatCents(row.amountCents)}
                {row.recurringPeriod
                  ? ` · ${BILLING_PERIOD_LABELS[row.recurringPeriod].toLocaleLowerCase("fr-FR")}`
                  : ""}
              </span>
            ),
          },
          {
            key: "nature",
            header: "Nature",
            width: 110,
            cell: (row) => (
              <Badge tone={row.nature === "actual" ? "success" : "neutral"}>
                {COST_NATURE_LABELS[row.nature]}
              </Badge>
            ),
          },
          ...(canManage
            ? [
                {
                  key: "actions",
                  header: "",
                  width: 76,
                  cell: (row: (typeof page.items)[number]) => (
                    <CostRowActions cost={row} options={options} />
                  ),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
