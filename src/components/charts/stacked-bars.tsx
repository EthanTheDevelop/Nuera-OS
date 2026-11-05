"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ChartShell, niceMax, type ChartPoint, type ChartValueFormat } from "./chart-shell";

export interface StackedSeries {
  key: string;
  label: string;
  /** Une valeur par point. */
  values: readonly number[];
}

/**
 * Barres empilées (tuile Chiffre d'affaires, Figma 58:264) : deux séries au plus lisibles, le mois
 * courant en couleur pleine, les mois passés plus clairs. Les barres montent une à une, 25 ms d'écart.
 * Couleurs imposées par Figma : 1re série `--accent`, 2e `--ink`.
 */
export function StackedBars({
  title,
  summary,
  points,
  series,
  valueFormat,
  highlightIndex = points.length - 1,
  height = 150,
  showYAxis = false,
  header,
  className,
}: {
  /** À gauche de la légende, sur sa ligne. */
  header?: ReactNode;
  title: string;
  summary?: string;
  points: readonly ChartPoint[];
  series: readonly StackedSeries[];
  valueFormat?: ChartValueFormat;
  /** Point en couleur pleine (le mois courant). `-1` : aucun. */
  highlightIndex?: number;
  height?: number | "fill";
  showYAxis?: boolean;
  className?: string;
}) {
  const totals = points.map((_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  );
  const max = niceMax(Math.max(0, ...totals));

  return (
    <ChartShell
      title={title}
      summary={summary}
      points={points}
      seriesLabels={series.map((item) => item.label)}
      rowsByPoint={points.map((_, index) =>
        series.map((item) => ({ label: item.label, value: item.values[index] ?? 0 })),
      )}
      valueFormat={valueFormat}
      ticks={[max, max / 2, 0]}
      showYAxis={showYAxis}
      height={height}
      showCrosshair={false}
      header={header}
      legend={series.map((item, index) => ({
        label: item.label,
        color: index === 0 ? "var(--accent)" : "var(--ink)",
      }))}
      className={className}
    >
      {(active) => (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
          {points.map((point, pointIndex) => {
            const dimmed = active !== null && active !== pointIndex;
            const full = pointIndex === highlightIndex || active === pointIndex;
            return (
              <div
                key={`${point.label}-${pointIndex}`}
                className="flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <div
                  className={cn(
                    "flex h-full w-[44%] max-w-[52px] flex-col justify-end transition-opacity duration-(--dur-fast)",
                    dimmed && "opacity-40",
                  )}
                >
                  <div
                    style={
                      {
                        height: `${(totals[pointIndex] ?? 0) * (100 / max)}%`,
                        "--i": pointIndex,
                      } as CSSProperties
                    }
                    className="anim-grow-y flex origin-bottom flex-col-reverse overflow-hidden rounded-t-sm rounded-b-[4px]"
                  >
                    {series.map((item, seriesIndex) => {
                      const value = item.values[pointIndex] ?? 0;
                      const total = totals[pointIndex] ?? 0;
                      return (
                        <span
                          key={item.key}
                          style={{ height: `${total > 0 ? (value / total) * 100 : 0}%` }}
                          className={cn(
                            "block w-full transition-colors duration-(--dur-fast)",
                            seriesIndex === 0 ? (full ? "bg-accent" : "bg-accent/45") : "bg-ink",
                          )}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChartShell>
  );
}
