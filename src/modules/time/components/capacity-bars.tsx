"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ChartShell } from "@/components/charts/chart-shell";
import { loadTone, type GaugeTone } from "@/components/ui/gauge";
import { cn } from "@/lib/cn";
import { formatDateShort, formatDays } from "@/lib/format";
import type { WeekLoad } from "../capacity";
import { weekBarLabel } from "../time-format";

const FILL: Record<GaugeTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warn: "bg-warn",
  danger: "bg-danger",
  chatgpt: "bg-chatgpt",
};

const CHART_HEIGHT = 120;

/** Largeur où six libellés `S45 · 90 %` ne tiennent plus côte à côte. */
const NARROW_QUERY = "(max-width: 639px)";

function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

function Bar({
  week,
  index,
  scaleMax,
  dimmed,
}: {
  week: WeekLoad;
  index: number;
  scaleMax: number;
  dimmed: boolean;
}) {
  const reduced = useReducedMotion() ?? false;
  const percent = week.loadPercent ?? 0;
  const tone = loadTone(percent);
  const toned = tone !== "accent";
  // Une semaine chargée ne prend sa couleur qu'en fin de course (note Mouvement), jamais avant.
  const [holding, setHolding] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // La montée elle-même fait foi : son horloge démarre à l'affichage, après le chargement du serveur.
    const rise = bar.current
      ?.getAnimations()
      .find((animation) => (animation as CSSAnimation).animationName === "nu-grow-y");
    if (!toned || reduced || !rise || rise.playState === "finished") return;
    let current = true;
    const hold = window.setTimeout(() => setHolding(true), 0);
    const release = () => {
      if (current) setHolding(false);
    };
    rise.finished.then(release, release);
    return () => {
      current = false;
      window.clearTimeout(hold);
    };
    // Décidé une fois, à l'arrivée : ensuite la couleur suit la valeur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-1 items-end justify-center">
      <div
        ref={bar}
        style={
          {
            height: `${(percent / scaleMax) * 100}%`,
            minHeight: percent > 0 ? 4 : 0,
            "--i": index,
          } as CSSProperties
        }
        className={cn(
          "anim-grow-y w-[42%] max-w-[72px] rounded-md transition-[background-color,opacity] duration-(--dur-fast)",
          holding ? "bg-accent" : FILL[tone],
          dimmed && "opacity-40",
        )}
      />
    </div>
  );
}

/**
 * Capacité sur 6 semaines (Figma 100:5442) : prévu / disponible, de la semaine courante aux cinq
 * suivantes. Couleurs de l'arbitrage A7 par `loadTone`.
 */
export function CapacityBars({ weeks }: { weeks: readonly WeekLoad[] }) {
  const scaleMax = Math.max(100, ...weeks.map((week) => week.loadPercent ?? 0));
  const overloaded = weeks.filter((week) => (week.loadPercent ?? 0) > 100).length;
  const narrow = useNarrow();

  return (
    <div className="flex flex-col gap-1">
      <ChartShell
        title="Capacité sur 6 semaines"
        summary={
          overloaded > 0
            ? `${overloaded} semaine${overloaded > 1 ? "s" : ""} au-dessus de la capacité.`
            : "Aucune semaine au-dessus de la capacité."
        }
        points={weeks.map((week) => ({
          label: narrow ? week.label : weekBarLabel(week.label, week.loadPercent),
          tooltipLabel: `${week.label} · du ${formatDateShort(week.weekStart)} au ${formatDateShort(week.weekEnd)}`,
        }))}
        seriesLabels={["Charge", "Prévu", "Disponible"]}
        rowsByPoint={weeks.map((week) => [
          {
            label: "Charge",
            value: week.loadPercent ?? 0,
            text: week.loadPercent === null ? "Pas de capacité" : `${week.loadPercent} %`,
          },
          { label: "Prévu", value: week.plannedMinutes, text: formatDays(week.plannedMinutes) },
          {
            label: "Disponible",
            value: week.capacityMinutes,
            text: formatDays(week.capacityMinutes),
          },
        ])}
        ticks={[]}
        showYAxis={false}
        showCrosshair={false}
        height={CHART_HEIGHT}
      >
        {(active) => (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
            {weeks.map((week, index) => (
              <Bar
                key={week.weekKey}
                week={week}
                index={index}
                scaleMax={scaleMax}
                dimmed={active !== null && active !== index}
              />
            ))}
          </div>
        )}
      </ChartShell>
      {narrow ? (
        <div aria-hidden="true" className="flex">
          {weeks.map((week) => (
            <span
              key={week.weekKey}
              className="flex-1 text-center font-mono text-table-head text-muted"
            >
              {week.loadPercent === null ? "—" : `${week.loadPercent} %`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
