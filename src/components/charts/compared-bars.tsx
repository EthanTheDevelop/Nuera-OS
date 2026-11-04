"use client";

import { GrowBar } from "@/components/motion/grow-bar";
import { cn } from "@/lib/cn";
import { ChartShell, niceMax, type ChartPoint, type ChartValueFormat } from "./chart-shell";

/**
 * Barres comparées (écran 16) : deux périodes côte à côte, 2026 en accent, 2025 en accent pâle.
 * Survol : les autres mois pâlissent, l'info-bulle donne les deux valeurs et l'écart.
 */
export function ComparedBars({
  title,
  summary,
  points,
  current,
  previous,
  valueFormat,
  height = 200,
  className,
}: {
  title: string;
  summary?: string;
  points: readonly ChartPoint[];
  current: { label: string; values: readonly number[] };
  previous: { label: string; values: readonly number[] };
  valueFormat?: ChartValueFormat;
  height?: number;
  className?: string;
}) {
  const max = niceMax(Math.max(0, ...current.values, ...previous.values));

  return (
    <ChartShell
      title={title}
      summary={summary}
      points={points}
      seriesLabels={[current.label, previous.label]}
      rowsByPoint={points.map((_, index) => [
        { label: current.label, value: current.values[index] ?? 0 },
        { label: previous.label, value: previous.values[index] ?? 0 },
      ])}
      valueFormat={valueFormat}
      ticks={[max, max / 2, 0]}
      height={height}
      showCrosshair={false}
      legend={[
        { label: current.label, color: "var(--accent)" },
        { label: previous.label, color: "var(--accent-pale)" },
      ]}
      className={className}
    >
      {(active) => (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
          {points.map((point, index) => (
            <div
              key={`${point.label}-${index}`}
              className={cn(
                "flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 transition-opacity duration-(--dur-fast)",
                active !== null && active !== index && "opacity-40",
              )}
            >
              <span className="h-full w-[22%] max-w-5">
                <GrowBar
                  axis="y"
                  index={index * 2}
                  value={(previous.values[index] ?? 0) / max}
                  className="h-full rounded-t-[4px] bg-accent-pale"
                />
              </span>
              <span className="h-full w-[22%] max-w-5">
                <GrowBar
                  axis="y"
                  index={index * 2 + 1}
                  value={(current.values[index] ?? 0) / max}
                  className="h-full rounded-t-[4px] bg-accent"
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </ChartShell>
  );
}
