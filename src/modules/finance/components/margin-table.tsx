import { Gauge } from "@/components/ui/gauge";
import { DataTable, type DataTablePage, type DataTableQuery } from "@/components/ui/data-table";
import { EmptyState } from "@/components/states/states";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { isFinishedProjectStatus, type MARGIN_SCOPE_LABELS } from "../finance.constants";
import type { ProfitabilityRow } from "../profitability.service";
import { marginTone } from "./finance-format";

type Scope = keyof typeof MARGIN_SCOPE_LABELS;

/**
 * Coût réel : au survol de la ligne, l'écart avec le coût estimé se dessine en barre, verte ou ambre
 * (note 21). La valeur reste lisible sans survol ; l'écart est aussi annoncé aux lecteurs d'écran.
 */
function ActualCost({ row }: { row: ProfitabilityRow }) {
  const { actual, forecast } = row.margin;
  const inProgress = row.margin.scope === "project" && !isFinishedProjectStatus(row.status);
  if (actual.totalCostCents === 0 && inProgress) return <span>en cours</span>;

  const gap = actual.totalCostCents - forecast.totalCostCents;
  const ratio =
    forecast.totalCostCents > 0 ? Math.min(1, Math.abs(gap) / forecast.totalCostCents) : 0;
  return (
    <span
      className="relative inline-block pb-1"
      title={
        forecast.totalCostCents > 0
          ? `Écart sur le coût estimé : ${formatCentsSigned(gap)}`
          : undefined
      }
    >
      {formatCents(actual.totalCostCents)}
      {forecast.totalCostCents > 0 ? (
        <>
          <span className="sr-only">, écart {formatCentsSigned(gap)} sur le coût estimé</span>
          <span
            aria-hidden="true"
            title={`Écart sur l'estimé : ${formatCentsSigned(gap)}`}
            style={{ width: `${Math.max(8, ratio * 100)}%` }}
            className={cn(
              "absolute bottom-0 left-0 h-[3px] origin-left scale-x-0 rounded-gauge transition-transform duration-(--dur-base) ease-out",
              "[tr:focus-within_&]:scale-x-100 [tr:hover_&]:scale-x-100",
              gap > 0 ? "bg-warn" : "bg-success",
            )}
          />
        </>
      ) : null}
    </span>
  );
}

function ActualMargin({ row }: { row: ProfitabilityRow }) {
  const percent = row.margin.actual.marginPercent;
  if (percent === null) {
    return <span>—</span>;
  }
  return (
    <span className="flex items-center gap-3">
      {percent > 0 ? (
        <Gauge
          value={percent}
          tone={marginTone(percent)}
          height={5}
          label={`Marge réelle de ${row.title}`}
          valueText={formatPercent(percent)}
          className="w-[70px] shrink-0"
        />
      ) : null}
      <span className="tabular">{formatPercent(percent)}</span>
    </span>
  );
}

/** Rentabilité (écran 21, 101:5550) : PRIX, COÛT ESTIMÉ, COÛT RÉEL, MARGE RÉELLE. */
export function MarginTable({
  rows,
  scope,
  firstHeader,
  caption,
  query,
  pagination,
  className,
}: {
  rows: readonly ProfitabilityRow[];
  scope: Scope;
  firstHeader: string;
  caption: string;
  query?: DataTableQuery;
  pagination?: DataTablePage;
  className?: string;
}) {
  return (
    <DataTable
      className={className}
      caption={caption}
      rows={rows}
      rowKey={(row) => row.id}
      rowHref={(row) => `/finances/rentabilite/${scope}/${row.id}`}
      query={query}
      pagination={pagination}
      empty={
        <EmptyState
          compact
          icon="chart"
          title="Rien à calculer pour l'instant"
          description="La marge apparaît dès qu'un devis, une facture ou un coût est rattaché."
        />
      }
      columns={[
        {
          key: "subject",
          header: firstHeader,
          primary: true,
          cell: (row) => (
            <span
              className="block truncate text-row-primary text-ink"
              title={row.subtitle ? `${row.title} · ${row.subtitle}` : row.title}
            >
              {row.title}
            </span>
          ),
        },
        {
          key: "price",
          header: "Prix",
          width: 110,
          cell: (row) => (
            <span className="tabular">{formatCents(row.margin.forecast.revenueCents)}</span>
          ),
        },
        {
          key: "forecast",
          header: "Coût estimé",
          width: 110,
          cell: (row) => (
            <span className="tabular">
              {row.margin.forecast.totalCostCents > 0
                ? formatCents(row.margin.forecast.totalCostCents)
                : "—"}
            </span>
          ),
        },
        {
          key: "actual",
          header: "Coût réel",
          width: 110,
          cell: (row) => (
            <span className="tabular">
              <ActualCost row={row} />
            </span>
          ),
        },
        {
          key: "margin",
          header: "Marge réelle",
          width: 150,
          cell: (row) => <ActualMargin row={row} />,
        },
      ]}
    />
  );
}
