"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { RollingNumber } from "@/components/motion/rolling-number";
import { ConnectionRequired, EmptyState, ErrorState } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { budgetTone, Gauge, loadTone } from "@/components/ui/gauge";
import { Icon } from "@/components/ui/icon";
import { TileFigure } from "@/components/ui/tile";
import { cn } from "@/lib/cn";
import type { DashboardTileSize } from "../dashboard.tiles";
import type {
  TileFigureView,
  TileGaugeView,
  TileRow,
  TileRowStyle,
  TileState,
  TileView,
} from "../dashboard.types";

const EURO_FORMAT = {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
} as const;

/** Combien de lignes tiennent, selon leur hauteur (Figma 01 et « Tuiles vivantes »). */
const ROW_CAPACITY: Record<TileRowStyle, Record<"2x1" | "2x2" | "4x2", number>> = {
  plain: { "2x1": 4, "2x2": 10, "4x2": 10 },
  gauge: { "2x1": 2, "2x2": 7, "4x2": 7 },
  avatar: { "2x1": 1, "2x2": 3, "4x2": 3 },
  date: { "2x1": 2, "2x2": 6, "4x2": 6 },
  dot: { "2x1": 3, "2x2": 10, "4x2": 10 },
  badge: { "2x1": 2, "2x2": 6, "4x2": 6 },
};

const COMPACT_ROWS = 2;

const DOT = {
  success: "bg-success",
  warn: "bg-warn",
  danger: "bg-danger",
  neutral: "bg-muted",
};

const VALUE_TONE = {
  muted: "text-muted",
  warn: "text-warn",
  danger: "text-danger",
  success: "text-success",
};

function Figure({ figure }: { figure: TileFigureView }): ReactNode {
  if (figure.kind === "text") return figure.text;
  return (
    <RollingNumber
      value={figure.value}
      format={figure.kind === "euros" ? EURO_FORMAT : undefined}
      suffix={figure.suffix}
    />
  );
}

function gaugeTone(gauge: TileGaugeView) {
  if (gauge.tone) return gauge.tone;
  const value = gauge.scaleValue ?? gauge.percent;
  return gauge.scale === "budget" ? budgetTone(value) : loadTone(value);
}

function RowLink({
  row,
  editing,
  className,
  children,
}: {
  row: TileRow;
  editing: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!row.href || editing) return <div className={className}>{children}</div>;
  return (
    <Link
      href={row.href}
      className={cn("relative z-10 block rounded-sm hover:bg-accent-pale/40", className)}
    >
      {children}
    </Link>
  );
}

function RowValue({ row }: { row: TileRow }) {
  if (!row.value) return null;
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-table-head font-normal whitespace-nowrap",
        VALUE_TONE[row.tone ?? "muted"],
      )}
    >
      {row.value}
    </span>
  );
}

function GaugeRow({ row, index, editing }: { row: TileRow; index: number; editing: boolean }) {
  return (
    <RowLink row={row} editing={editing} className="flex flex-col gap-1.5 py-0.5">
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-text">{row.label}</span>
        <RowValue row={row} />
        {row.detail ? (
          <span className="tabular shrink-0 text-sm text-text">{row.detail}</span>
        ) : null}
      </span>
      {row.gauge ? (
        <Gauge
          value={row.gauge.percent}
          tone={gaugeTone(row.gauge)}
          label={row.label}
          valueText={row.gauge.valueText}
          index={index}
        />
      ) : null}
    </RowLink>
  );
}

function AvatarRow({ row, editing }: { row: TileRow; editing: boolean }) {
  return (
    <RowLink row={row} editing={editing} className="flex gap-3 py-1">
      <Avatar initials={row.initials} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.label}</span>
          <RowValue row={row} />
        </span>
        {row.detail ? <span className="truncate text-xs text-muted">{row.detail}</span> : null}
        {row.suggestion ? (
          <span className="flex items-center gap-1 text-xs text-chatgpt">
            <Icon name="sparkle" size={14} />
            Réponse suggérée prête
          </span>
        ) : null}
      </span>
    </RowLink>
  );
}

function DateRow({ row, editing }: { row: TileRow; editing: boolean }) {
  return (
    <RowLink row={row} editing={editing} className="flex items-center gap-3 py-0.5">
      <span className="shrink-0 rounded-sm bg-accent-pale px-2 py-1 font-mono text-table-head font-normal whitespace-nowrap text-accent">
        {row.dateChip}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">{row.label}</span>
        {row.detail ? <span className="truncate text-xs text-muted">{row.detail}</span> : null}
      </span>
    </RowLink>
  );
}

function DotRow({ row, editing }: { row: TileRow; editing: boolean }) {
  return (
    <RowLink row={row} editing={editing} className="flex items-center gap-2 py-0.5">
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", DOT[row.dot ?? "neutral"])}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-text">{row.label}</span>
      <RowValue row={row} />
    </RowLink>
  );
}

function BadgeRow({ row, editing }: { row: TileRow; editing: boolean }) {
  return (
    <RowLink row={row} editing={editing} className="flex items-center gap-3 py-0.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">{row.label}</span>
        {row.detail ? <span className="truncate text-xs text-muted">{row.detail}</span> : null}
      </span>
      {row.badge ? <Badge tone={row.badge.tone}>{row.badge.label}</Badge> : null}
    </RowLink>
  );
}

function PlainRow({ row, editing }: { row: TileRow; editing: boolean }) {
  return (
    <RowLink row={row} editing={editing} className="flex items-baseline gap-2 py-0.5">
      <span className="min-w-0 flex-1 truncate text-sm text-text">
        {row.label}
        {row.detail ? <span className="text-xs text-muted"> · {row.detail}</span> : null}
      </span>
      <RowValue row={row} />
      {row.badge ? <Badge tone={row.badge.tone}>{row.badge.label}</Badge> : null}
    </RowLink>
  );
}

function Rows({
  rows,
  style,
  size,
  compact,
  editing,
}: {
  rows: readonly TileRow[];
  style: TileRowStyle;
  size: Exclude<DashboardTileSize, "1x1">;
  compact: boolean;
  editing: boolean;
}) {
  const shown = rows.slice(0, compact ? COMPACT_ROWS : ROW_CAPACITY[style][size]);
  if (shown.length === 0) return null;
  return (
    <ul className={cn("flex min-w-0 flex-col", style === "avatar" ? "gap-3" : "gap-1.5")}>
      {shown.map((row, index) => (
        <li key={row.id} className="min-w-0">
          {compact ? (
            <PlainRow
              row={{ ...row, detail: undefined, value: row.value ?? row.detail }}
              editing={editing}
            />
          ) : style === "gauge" ? (
            <GaugeRow row={row} index={index} editing={editing} />
          ) : style === "avatar" ? (
            <AvatarRow row={row} editing={editing} />
          ) : style === "date" ? (
            <DateRow row={row} editing={editing} />
          ) : style === "dot" ? (
            <DotRow row={row} editing={editing} />
          ) : style === "badge" ? (
            <BadgeRow row={row} editing={editing} />
          ) : (
            <PlainRow row={row} editing={editing} />
          )}
        </li>
      ))}
    </ul>
  );
}

function TileEmpty({ view, editing }: { view: TileView; editing: boolean }) {
  const empty = view.empty;
  if (!empty) return null;
  return (
    <EmptyState
      compact
      icon="plus"
      title={empty.title}
      description={empty.description}
      className="my-auto py-0"
      action={
        empty.actionHref && !editing ? (
          <Link
            href={empty.actionHref}
            className="hit-44 relative z-10 text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            {empty.actionLabel}
          </Link>
        ) : undefined
      }
    />
  );
}

function RevenueChart({ view }: { view: TileView }) {
  const chart = view.chart;
  if (!chart) return null;
  return (
    <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-end gap-3">
      <p className="tabular text-figure-hero text-ink">
        <Figure figure={view.figure} />
      </p>
      <StackedBars
        title="Chiffre d’affaires sur six mois"
        summary={view.note}
        points={chart.points}
        series={[
          { key: "projects", label: "Projets", values: chart.projects },
          { key: "recurring", label: "Récurrent", values: chart.recurring },
        ]}
        valueFormat={{ format: EURO_FORMAT }}
        height={150}
        header={<span className="text-sm text-muted">{view.note}</span>}
      />
    </div>
  );
}

/**
 * Contenu d'une tuile selon son format (« Tuiles vivantes ») : plus elle est grande, plus elle montre
 * de lignes. Le 1×1 ne garde que le chiffre et sa note.
 */
export function TileBody({
  state,
  size,
  editing,
  service,
}: {
  state: TileState | undefined;
  size: DashboardTileSize;
  editing: boolean;
  service: string;
}) {
  if (!state) return null;
  if (state.status === "error") {
    return (
      <ErrorState
        compact
        title="Tuile indisponible"
        description={size === "1x1" ? "Réessayez plus tard." : "Cette donnée n’a pas pu être lue."}
        className="my-auto py-0"
      />
    );
  }
  if (state.status === "unavailable") {
    return (
      <ConnectionRequired
        compact
        service={service}
        missing={state.message}
        showSettingsLink={false}
        className="my-auto py-0"
      />
    );
  }

  const { view } = state;
  if (size === "1x1") {
    return (
      <TileFigure
        value={<Figure figure={view.figure} />}
        note={view.note ? <span className="line-clamp-2">{view.note}</span> : undefined}
        noteTone={view.noteTone}
        unit={view.unit && view.figure.kind !== "text" ? view.unit : undefined}
      />
    );
  }
  if (view.empty) return <TileEmpty view={view} editing={editing} />;
  if (size === "4x2" && view.chart) return <RevenueChart view={view} />;

  const rowsOnly = view.rowsOnlyAt?.includes(size) ?? false;
  const style = view.rowStyle ?? "plain";
  const rowsHidden = view.rowsFrom2x2 && size === "2x1";
  // Sous le chiffre, un 2×1 n'a la place que de deux lignes simples.
  const compact = size === "2x1" && !rowsOnly;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {view.stale ? <p className="text-xs text-warn">Dernière mesure : {view.stale}</p> : null}
      {view.partial ? <p className="text-xs text-warn">{view.partial}</p> : null}
      {rowsOnly ? null : (
        <TileFigure
          className="mt-0"
          hero={size === "2x2" && Boolean(view.chart)}
          value={<Figure figure={view.figure} />}
          unit={view.unit}
          note={size === "2x1" ? undefined : view.note}
          noteTone={view.noteTone}
        />
      )}
      {view.gauge ? (
        <Gauge
          height={8}
          value={Math.min(100, view.gauge.percent)}
          tone={gaugeTone(view.gauge)}
          label="Charge du mois"
          valueText={view.gauge.valueText}
        />
      ) : null}
      {!rowsOnly &&
      (view.gauge || (size === "2x1" && (view.rows?.length ?? 0) === 0)) &&
      view.note ? (
        <p className={cn("line-clamp-2 text-kpi-note", VALUE_TONE[view.noteTone ?? "muted"])}>
          {view.note}
        </p>
      ) : null}
      {rowsHidden ? null : (
        <Rows
          rows={view.rows ?? []}
          style={style}
          size={size}
          compact={compact}
          editing={editing}
        />
      )}
    </div>
  );
}

/** Badge de l'en-tête : la charge suit les seuils de l'arbitrage A7. */
export function tileBadge(state: TileState | undefined): ReactNode {
  if (state?.status !== "ready") return null;
  const { view } = state;
  if (view.loadPercent !== undefined) {
    const tone = loadTone(view.loadPercent);
    return (
      <Badge tone={tone === "danger" ? "danger" : tone === "warn" ? "warn" : "accent"}>
        {view.loadPercent} %
      </Badge>
    );
  }
  if (view.badge) return <Badge tone={view.badge.tone}>{view.badge.label}</Badge>;
  return null;
}
