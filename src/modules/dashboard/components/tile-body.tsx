"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { fittedFontSize, RollingNumber } from "@/components/motion/rolling-number";
import { ConnectionRequired, EmptyState, ErrorState } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { budgetTone, Gauge, loadTone } from "@/components/ui/gauge";
import { Icon } from "@/components/ui/icon";
import { TileFigure } from "@/components/ui/tile";
import { cn } from "@/lib/cn";
import { TILE_MAX_SPAN, tileSpan, type DashboardTileSize } from "../dashboard.tiles";
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

/** Un chiffre en texte (`12 h / 30 h`) peut être plus long qu'un montant : il réduit davantage. */
const TEXT_FIGURE_FLOOR = 0.45;

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
  if (figure.kind === "text") {
    return (
      <span
        className="inline-block max-w-full truncate align-bottom"
        style={{ fontSize: fittedFontSize(figure.text.length, TEXT_FIGURE_FLOOR) }}
      >
        {figure.text}
      </span>
    );
  }
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
      data-tile-value
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
        <span data-tile-wide className="contents">
          <RowValue row={row} />
        </span>
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
          <span data-tile-wide className="contents">
            <RowValue row={row} />
          </span>
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
      {row.badge ? (
        <span data-tile-wide className="contents">
          <Badge tone={row.badge.tone}>{row.badge.label}</Badge>
        </span>
      ) : null}
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
      {row.badge ? (
        <span data-tile-wide className="contents">
          <Badge tone={row.badge.tone}>{row.badge.label}</Badge>
        </span>
      ) : null}
    </RowLink>
  );
}

/**
 * La mise en page écarte les lignes qui ne tiennent pas (`tile-rows`, colonne suivante, hors cadre).
 * Reste à les retirer du clavier et des lecteurs d'écran, et à masquer une première ligne trop haute.
 */
function useClippedRows(count: number) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const update = () => {
      const items = Array.from(element.children) as HTMLElement[];
      const origin = items[0];
      if (!origin) return;
      for (const item of items) {
        const clipped =
          item.offsetLeft > origin.offsetLeft ||
          item.offsetTop + item.offsetHeight > origin.offsetTop + element.clientHeight;
        item.inert = clipped;
        item.toggleAttribute("data-clipped", clipped);
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  return list;
}

function Rows({
  rows,
  style,
  compact,
  editing,
}: {
  rows: readonly TileRow[];
  style: TileRowStyle;
  compact: boolean;
  editing: boolean;
}) {
  const list = useClippedRows(rows.length);
  if (rows.length === 0) return null;
  return (
    <ul ref={list} className={cn("tile-rows", style === "avatar" ? "gap-3" : "gap-1.5")}>
      {rows.map((row, index) => (
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
      className="tile-state my-auto py-0"
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
    <div className="tile-chart">
      <StackedBars
        title="Chiffre d’affaires sur six mois"
        summary={view.note}
        points={chart.points}
        series={[
          { key: "projects", label: "Projets", values: chart.projects },
          { key: "recurring", label: "Récurrent", values: chart.recurring },
        ]}
        valueFormat={{ format: EURO_FORMAT }}
        height="fill"
      />
    </div>
  );
}

/**
 * Contenu d'une tuile (« Tuiles vivantes ») : le format décide de ce qui est proposé, le cadre de ce
 * qui tient (`tile-body` dans globals.css, requêtes de conteneur). Le 1×1 garde le chiffre et sa note.
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
  const { columns, rows: rowSpan } = tileSpan(size, TILE_MAX_SPAN);
  const mini = columns === 1 && rowSpan === 1;
  const short = rowSpan === 1;
  if (state.status === "error") {
    return (
      <ErrorState
        compact
        title="Tuile indisponible"
        description={mini ? "Réessayez plus tard." : "Cette donnée n’a pas pu être lue."}
        className="tile-state my-auto py-0"
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
        className="tile-state my-auto py-0"
      />
    );
  }

  const { view } = state;
  if (mini) {
    return (
      <TileFigure
        value={<Figure figure={view.figure} />}
        note={view.note ? <span className="line-clamp-2">{view.note}</span> : undefined}
        noteTone={view.noteTone}
        reserveNote
      />
    );
  }
  if (view.empty) return <TileEmpty view={view} editing={editing} />;

  const rowsOnly =
    view.rowsFirst === "always" ||
    (view.rowsFirst === "tall" && !short) ||
    (view.rowsFirst === "short" && short);
  const style = view.rowStyle ?? "plain";
  const rows = view.rows ?? [];
  const chart = !rowsOnly && Boolean(view.chart);
  // Sur une rangée, la note ne reste que seule à côté du chiffre : un avis de fraîcheur passe avant.
  const noticed = Boolean(view.stale || view.partial);
  const noteBelow =
    !rowsOnly &&
    Boolean(view.note) &&
    (view.gauge || (short && !noticed && (chart || rows.length === 0)));
  const noteInFigure = !short && !view.gauge && !rowsOnly;
  const note = view.noteItems?.length ? (
    <span className="tile-note-items flex flex-wrap gap-x-2">
      {view.noteItems.map((item) => (
        <span
          key={item.text}
          className={cn("whitespace-nowrap", item.tone === "danger" && "font-medium text-danger")}
        >
          {item.text}
        </span>
      ))}
    </span>
  ) : (
    <span className={cn("tile-note line-clamp-2", VALUE_TONE[view.noteTone ?? "muted"])}>
      {view.note}
    </span>
  );

  return (
    <div className={cn("tile-stack", !rowsOnly && "tile-stack--split")}>
      {rowsOnly && !noticed ? null : (
        <div className="tile-primary">
          {view.stale ? (
            <p className="truncate text-xs text-warn">Dernière mesure : {view.stale}</p>
          ) : null}
          {view.partial ? <p className="truncate text-xs text-warn">{view.partial}</p> : null}
          {rowsOnly ? null : (
            <TileFigure
              className="mt-0"
              hero={chart && !short}
              value={<Figure figure={view.figure} />}
              unit={view.unit}
              note={noteInFigure && view.note ? note : undefined}
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
          {noteBelow ? <p className="text-kpi-note">{note}</p> : null}
        </div>
      )}
      {chart ? (
        <RevenueChart view={view} />
      ) : view.rowsWhenTall && short ? null : (
        <Rows rows={rows} style={style} compact={short && !rowsOnly} editing={editing} />
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
