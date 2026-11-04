"use client";

import { GrowBar } from "@/components/motion/grow-bar";
import { cn } from "@/lib/cn";
import { ChartShell, niceMax, type ChartPoint, type ChartValueFormat } from "./chart-shell";

/**
 * Barres gagnées / perdues (mesure « Conversion » de l'écran 16) : les gagnées montent de l'axe
 * central en `success`, les perdues descendent en `danger`.
 */
export function WonLostBars({
  title,
  summary,
  points,
  won,
  lost,
  wonLabel = "Gagnées",
  lostLabel = "Perdues",
  valueFormat,
  height = 200,
  className,
}: {
  title: string;
  summary?: string;
  points: readonly ChartPoint[];
  won: readonly number[];
  lost: readonly number[];
  wonLabel?: string;
  lostLabel?: string;
  valueFormat?: ChartValueFormat;
  height?: number;
  className?: string;
}) {
  const max = niceMax(Math.max(0, ...won, ...lost));

  return (
    <ChartShell
      title={title}
      summary={summary}
      points={points}
      seriesLabels={[wonLabel, lostLabel]}
      rowsByPoint={points.map((_, index) => [
        { label: wonLabel, value: won[index] ?? 0 },
        { label: lostLabel, value: lost[index] ?? 0 },
      ])}
      valueFormat={valueFormat}
      ticks={[max, 0, -max]}
      height={height}
      showCrosshair={false}
      legend={[
        { label: wonLabel, color: "var(--success)" },
        { label: lostLabel, color: "var(--danger)" },
      ]}
      className={className}
    >
      {(active) => (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
          {points.map((point, index) => (
            <div
              key={`${point.label}-${index}`}
              className={cn(
                "flex h-full min-w-0 flex-1 flex-col items-center transition-opacity duration-(--dur-fast)",
                active !== null && active !== index && "opacity-40",
              )}
            >
              <span className="h-1/2 w-[40%] max-w-7">
                <GrowBar
                  axis="y"
                  index={index}
                  value={(won[index] ?? 0) / max}
                  className="h-full rounded-t-[4px] bg-success"
                />
              </span>
              <span className="h-1/2 w-[40%] max-w-7">
                <GrowBar
                  axis="y"
                  downward
                  index={index}
                  value={(lost[index] ?? 0) / max}
                  className="h-full rounded-b-[4px] bg-danger"
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </ChartShell>
  );
}
