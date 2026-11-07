"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { ChartShell, type ChartPoint } from "./chart-shell";

export type UptimeState = "up" | "slow" | "down" | "unknown";

export interface UptimeDay extends ChartPoint {
  state: UptimeState;
  /** Disponibilité du jour, en pourcentage. */
  ratio?: number;
}

const STATE_FILL: Record<UptimeState, string> = {
  up: "bg-success",
  slow: "bg-warn",
  down: "bg-danger",
  unknown: "bg-surface-raised",
};

const STATE_LABEL: Record<UptimeState, string> = {
  up: "En ligne",
  slow: "Lent",
  down: "Coupure",
  unknown: "Pas de mesure",
};

/**
 * Disponibilité sur 30 jours (écran 19, Figma 100:5750) : une barre par jour, de gauche à droite,
 * 25 ms d'écart. Vert, ambre si lent, rouge si coupure. Un jour sans mesure reste gris : ne jamais
 * le peindre en vert.
 */
export function UptimeBars({
  title,
  summary,
  days,
  height = 44,
  className,
}: {
  title: string;
  summary?: string;
  days: readonly UptimeDay[];
  height?: number;
  className?: string;
}) {
  return (
    <ChartShell
      title={title}
      summary={summary}
      points={days}
      seriesLabels={["État", "Disponibilité"]}
      rowsByPoint={days.map((day) => [
        { label: "État", value: 0, text: STATE_LABEL[day.state] },
        ...(day.ratio === undefined
          ? [{ label: "Disponibilité", value: 0, text: "—" }]
          : [
              {
                label: "Disponibilité",
                value: day.ratio,
                text: `${new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 2 }).format(day.ratio)} %`,
              },
            ]),
      ])}
      ticks={[]}
      showYAxis={false}
      showCrosshair={false}
      height={height}
      xLabelEvery={Math.max(1, Math.ceil(days.length / 6))}
      className={className}
    >
      {(active) => (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex gap-[2px] sm:gap-1"
        >
          {days.map((day, index) => (
            <span
              key={`${day.label}-${index}`}
              style={{ "--i": index } as CSSProperties}
              className={cn(
                "anim-grow-y h-full min-w-0 flex-1 origin-bottom rounded-[3px] transition-opacity duration-(--dur-fast)",
                STATE_FILL[day.state],
                active !== null && active !== index && "opacity-40",
              )}
            />
          ))}
        </div>
      )}
    </ChartShell>
  );
}
