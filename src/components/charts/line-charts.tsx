"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { ChartShell, niceMax, type ChartPoint, type ChartValueFormat } from "./chart-shell";

interface LineChartProps {
  title: string;
  summary?: string;
  points: readonly ChartPoint[];
  /** Une valeur par point. `null` : pas de donnée (trou dans la courbe, pas un zéro). */
  values: readonly (number | null)[];
  seriesLabel: string;
  valueFormat?: ChartValueFormat;
  /** Haut de l'échelle. Défaut : arrondi au-dessus du maximum. */
  max?: number;
  height?: number;
  className?: string;
}

const X = (index: number, count: number) => (count <= 1 ? 50 : (index / (count - 1)) * 100);
const Y = (value: number, max: number) => 100 - (value / max) * 100;

function segments(values: readonly (number | null)[]) {
  const runs: { index: number; value: number }[][] = [];
  let run: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ index, value });
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

function linePath(
  run: readonly { index: number; value: number }[],
  count: number,
  max: number,
  step: boolean,
) {
  return run
    .map(({ index, value }, position) => {
      const x = X(index, count);
      const y = Y(value, max);
      if (position === 0) return `M${x} ${y}`;
      if (!step) return `L${x} ${y}`;
      const previous = run[position - 1];
      return `L${x} ${previous ? Y(previous.value, max) : y}L${x} ${y}`;
    })
    .join("");
}

function Dots({
  values,
  max,
  active,
}: {
  values: readonly (number | null)[];
  max: number;
  active: number | null;
}) {
  return (
    <>
      {values.map((value, index) =>
        value === null ? null : (
          <span
            key={index}
            aria-hidden="true"
            style={{ left: `${X(index, values.length)}%`, top: `${Y(value, max)}%` }}
            className={cn(
              "anim-fade-late pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-[width,height] duration-(--dur-fast) ease-out",
              active === index ? "z-10 size-3 ring-2 ring-surface" : "size-1.5",
            )}
          />
        ),
      )}
    </>
  );
}

/**
 * Courbe avec aire (M2, Figma 138:6877) : la ligne se trace de gauche à droite (800 ms), l'aire suit
 * en fondu, les points et l'info-bulle aimantée au mois le plus proche.
 */
export function AreaLine({
  title,
  summary,
  points,
  values,
  seriesLabel,
  valueFormat,
  max,
  height = 152,
  className,
}: LineChartProps) {
  const uid = useId();
  const numbers = values.filter((value): value is number => value !== null);
  const top = max ?? niceMax(Math.max(0, ...numbers));
  const count = points.length;
  const runs = segments(values);

  return (
    <ChartShell
      title={title}
      summary={summary}
      points={points}
      seriesLabels={[seriesLabel]}
      rowsByPoint={values.map((value) => [
        value === null
          ? { label: seriesLabel, value: 0, text: "Pas de donnée" }
          : { label: seriesLabel, value },
      ])}
      valueFormat={valueFormat}
      ticks={[top, top / 2, 0]}
      xMode="edge"
      height={height}
      className={className}
    >
      {(active) => (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            <defs>
              <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {runs.map((run, index) => {
              const first = run[0];
              const last = run[run.length - 1];
              if (!first || !last) return null;
              return (
                <path
                  key={index}
                  className="anim-fade-late"
                  fill={`url(#${uid}-area)`}
                  d={`${linePath(run, count, top, false)}L${X(last.index, count)} 100L${X(first.index, count)} 100Z`}
                />
              );
            })}
            <g className="anim-wipe">
              {runs.map((run, index) => (
                <path
                  key={index}
                  d={linePath(run, count, top, false)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          </svg>
          <Dots values={values} max={top} active={active} />
        </>
      )}
    </ChartShell>
  );
}

/**
 * Courbe en escalier (mesure « Marge » de l'écran 16) : le tracé arrive en pointillé, puis se pleinit
 * (motion.md §2.3). Un palier se lit tant que la valeur ne change pas.
 */
export function StepLine({
  title,
  summary,
  points,
  values,
  seriesLabel,
  valueFormat,
  max,
  height = 152,
  className,
}: LineChartProps) {
  const numbers = values.filter((value): value is number => value !== null);
  const top = max ?? niceMax(Math.max(0, ...numbers));
  const count = points.length;
  const runs = segments(values);

  return (
    <ChartShell
      title={title}
      summary={summary}
      points={points}
      seriesLabels={[seriesLabel]}
      rowsByPoint={values.map((value) => [
        value === null
          ? { label: seriesLabel, value: 0, text: "Pas de donnée" }
          : { label: seriesLabel, value },
      ])}
      valueFormat={valueFormat}
      ticks={[top, top / 2, 0]}
      xMode="edge"
      height={height}
      className={className}
    >
      {(active) => (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            <g className="anim-wipe">
              {runs.map((run, index) => (
                <path
                  key={index}
                  d={linePath(run, count, top, true)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            <g className="anim-fade-late">
              {runs.map((run, index) => (
                <path
                  key={index}
                  d={linePath(run, count, top, true)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          </svg>
          <Dots values={values} max={top} active={active} />
        </>
      )}
    </ChartShell>
  );
}
