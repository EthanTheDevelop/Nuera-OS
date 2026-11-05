"use client";

import type { Format } from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Replay } from "@/components/motion/page-build";
import { RollingNumber } from "@/components/motion/rolling-number";
import { cn } from "@/lib/cn";

/**
 * Socle des graphiques : tout est en HTML et en pourcentages, mesuré nulle part à l'arrivée. Les
 * graphiques sont donc justes dès le HTML du serveur, à toute largeur. Seuls l'info-bulle et la
 * ligne qui suit la souris lisent la taille, au survol.
 *
 * Les props restent sérialisables : un composant serveur peut les passer directement.
 * Les valeurs arrivent dans l'unité d'affichage : convertir les centimes en euros avant.
 */

export type NoteTone = "muted" | "success" | "warn" | "danger";

export interface ChartPoint {
  /** Libellé d'axe (`Juin`). */
  label: string;
  /** Libellé d'info-bulle (`OCT. 2026`). Défaut : `label`. */
  tooltipLabel?: string;
  /** Note sous la valeur (`+1 300 € vs sept.`). */
  note?: string;
  noteTone?: NoteTone;
}

export interface ChartValueFormat {
  /** Options d'Intl.NumberFormat, locale `fr-FR`. */
  format?: Format;
  suffix?: string;
}

export interface ChartRow {
  label: string;
  /** Valeur pour la ligne de l'info-bulle et la table d'accessibilité. */
  value: number;
  /** Texte qui remplace la valeur (`Pas de donnée`). */
  text?: string;
}

export const NOTE_TONES: Record<NoteTone, string> = {
  muted: "text-muted",
  success: "text-success",
  warn: "text-warn",
  danger: "text-danger",
};

const FORMATTER_LOCALE = "fr-FR";

export function formatChartValue(value: number, { format, suffix }: ChartValueFormat): string {
  const text = new Intl.NumberFormat(FORMATTER_LOCALE, format).format(value);
  return suffix ? `${text}${suffix}` : text;
}

/** Échelle ronde : max au multiple supérieur de 1, 2, 2,5 ou 5 × 10ⁿ, pour 2 intervalles. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step =
    [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((candidate) => value <= candidate * magnitude) ?? 10;
  return step * magnitude;
}

export interface ChartShellProps {
  /** Titre annoncé : ce que montre le graphique. */
  title: string;
  /** Une phrase de synthèse, lue avant la table (`CA en hausse de 12 % sur 6 mois`). */
  summary?: string;
  points: readonly ChartPoint[];
  /** Lignes de chaque point : info-bulle et table d'accessibilité. Une entrée par point. */
  rowsByPoint: readonly (readonly ChartRow[])[];
  /** En-têtes des séries, pour la table d'accessibilité. */
  seriesLabels: readonly string[];
  valueFormat?: ChartValueFormat;
  /** Échelle, du haut vers le bas ; libellés à gauche si `showYAxis`. */
  ticks: readonly number[];
  showYAxis?: boolean;
  /** `band` : barres centrées dans leur case. `edge` : courbe du bord gauche au bord droit. */
  xMode?: "band" | "edge";
  /** En pixels, ou `fill` : le tracé prend la hauteur que son parent lui laisse. */
  height?: number | "fill";
  legend?: readonly { label: string; color: string }[];
  /** Ligne verticale aimantée : pointillée par défaut (M2). */
  showCrosshair?: boolean;
  /** Affiche un libellé d'axe sur `n` (`1` : tous). 30 barres : 1 sur 5. */
  xLabelEvery?: number;
  /** À gauche de la légende, sur sa ligne (`Novembre 2026 · encaissé et à encaisser`). */
  header?: ReactNode;
  className?: string;
  /** Dessin du graphique. Reçoit le point actif, pour pâlir les autres ou grossir un repère. */
  children: (active: number | null) => ReactNode;
}

/**
 * Enveloppe commune : axes, légende, repères, info-bulle qui suit, ligne aimantée au point le plus
 * proche, clavier (flèches, Début, Fin, Échap), table de données pour les lecteurs d'écran.
 */
export function ChartShell({
  title,
  summary,
  points,
  rowsByPoint,
  seriesLabels,
  valueFormat = {},
  ticks,
  showYAxis = true,
  xMode = "band",
  height = 152,
  legend,
  showCrosshair = true,
  xLabelEvery = 1,
  header,
  className,
  children,
}: ChartShellProps) {
  const uid = useId();
  const plot = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [geometry, setGeometry] = useState({ x: 0, tooltipX: 0, glide: false });
  const wasActive = useRef(false);

  const fractionOf = useCallback(
    (index: number) => {
      const count = Math.max(1, points.length);
      if (xMode === "edge") return count === 1 ? 0.5 : index / (count - 1);
      return (index + 0.5) / count;
    },
    [points.length, xMode],
  );

  // Après le rendu : la largeur de l'info-bulle dépend de son contenu.
  useLayoutEffect(() => {
    if (active === null || !plot.current) {
      wasActive.current = false;
      return;
    }
    const width = plot.current.clientWidth;
    const x = fractionOf(active) * width;
    const tipWidth = tooltip.current?.offsetWidth ?? 0;
    const gap = 12;
    // L'info-bulle passe de l'autre côté de la ligne avant de sortir du graphique.
    const right = x + gap;
    const tooltipX = right + tipWidth > width ? Math.max(0, x - gap - tipWidth) : right;
    // Elle glisse d'un point à l'autre, mais apparaît directement à sa place.
    setGeometry({ x, tooltipX, glide: wasActive.current });
    wasActive.current = true;
  }, [active, fractionOf]);

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!plot.current || points.length === 0) return;
    const box = plot.current.getBoundingClientRect();
    const fraction = (event.clientX - box.left) / box.width;
    const raw =
      xMode === "edge"
        ? Math.round(fraction * (points.length - 1))
        : Math.floor(fraction * points.length);
    setActive(Math.max(0, Math.min(points.length - 1, raw)));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const last = points.length - 1;
    const current = active ?? -1;
    const targets: Record<string, number> = {
      ArrowRight: Math.min(last, current + 1),
      ArrowLeft: current === -1 ? 0 : Math.max(0, current - 1),
      Home: 0,
      End: last,
    };
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    setActive(target);
  }

  const activePoint = active === null ? undefined : points[active];
  const activeRows = active === null ? undefined : rowsByPoint[active];

  const liveText = useMemo(() => {
    if (!activePoint || !activeRows) return "";
    const values = activeRows
      .map((row) => `${row.label} : ${row.text ?? formatChartValue(row.value, valueFormat)}`)
      .join(", ");
    return `${activePoint.tooltipLabel ?? activePoint.label}, ${values}${activePoint.note ? `, ${activePoint.note}` : ""}`;
  }, [activePoint, activeRows, valueFormat]);

  const preset = useMotionPreset();
  const fill = height === "fill";
  const plotHeight = fill ? undefined : height;

  return (
    <figure className={cn("m-0 flex min-w-0 flex-col gap-3", fill && "h-full min-h-0", className)}>
      <figcaption className="sr-only">
        {title}
        {summary ? `. ${summary}` : ""}
      </figcaption>

      {header || (legend && legend.length > 0) ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">{header}</div>
          {legend && legend.length > 0 ? (
            <ul
              aria-hidden="true"
              data-chart-legend
              className="flex flex-wrap justify-end gap-x-3 gap-y-1"
            >
              {legend.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-1.5 text-xs leading-[1.25] text-text"
                >
                  <span className="size-2 rounded-full" style={{ background: item.color }} />
                  {item.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={cn("flex min-w-0 gap-2", fill && "min-h-0 flex-1")}>
        {showYAxis ? (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={ticks.join("-")}
              aria-hidden="true"
              initial={preset.swapIn.initial}
              animate={preset.swapIn.animate}
              exit={preset.leave}
              style={{ height: plotHeight }}
              className="relative w-12 shrink-0"
            >
              {ticks.map((tick, index) => (
                <span
                  key={tick}
                  style={{ top: `${(index / Math.max(1, ticks.length - 1)) * 100}%` }}
                  className="absolute left-0 -translate-y-1/2 font-mono text-table-head font-normal whitespace-nowrap text-muted"
                >
                  {new Intl.NumberFormat(FORMATTER_LOCALE, { maximumFractionDigits: 0 }).format(
                    Math.abs(tick),
                  )}
                </span>
              ))}
            </motion.div>
          </AnimatePresence>
        ) : null}

        <div className={cn("min-w-0 flex-1", fill && "flex min-h-0 flex-col")}>
          <div
            ref={plot}
            tabIndex={0}
            role="group"
            aria-label={`${title}. Flèches gauche et droite pour parcourir les valeurs.`}
            aria-describedby={`${uid}-table`}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            style={{ height: plotHeight }}
            className={cn(
              "relative touch-pan-y rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
              fill && "min-h-0 flex-1",
            )}
          >
            {/* Repères recessifs, derrière le dessin. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {ticks.map((tick, index) => (
                <span
                  key={tick}
                  style={{ top: `${(index / Math.max(1, ticks.length - 1)) * 100}%` }}
                  className="absolute inset-x-0 h-px bg-border"
                />
              ))}
            </div>

            {children(active)}

            {/* Ligne qui s'aimante au point le plus proche et glisse d'un point à l'autre. */}
            {showCrosshair ? (
              <span
                aria-hidden="true"
                style={{ transform: `translateX(${geometry.x}px)` }}
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 w-0 border-l border-dashed border-muted duration-(--dur-fast) ease-out",
                  geometry.glide ? "transition-[transform,opacity]" : "transition-opacity",
                  active === null ? "opacity-0" : "opacity-100",
                )}
              />
            ) : null}

            {/* Info-bulle : glisse plutôt que de disparaître ; son nombre roule. */}
            <div
              ref={tooltip}
              aria-hidden="true"
              style={{ transform: `translateX(${geometry.tooltipX}px)` }}
              className={cn(
                "pointer-events-none absolute top-2 left-0 z-20 flex w-max max-w-[260px] flex-col gap-0.5 rounded-md bg-surface p-3 whitespace-nowrap shadow-float",
                "duration-(--dur-fast) ease-out",
                geometry.glide ? "transition-[transform,opacity]" : "transition-opacity",
                active === null ? "opacity-0" : "opacity-100",
              )}
            >
              {activePoint ? (
                <>
                  <p className="font-mono text-eyebrow text-muted uppercase">
                    {activePoint.tooltipLabel ?? activePoint.label}
                  </p>
                  {activeRows?.map((row) => (
                    <p key={row.label} className="flex items-baseline gap-2">
                      {activeRows.length > 1 ? (
                        <span className="text-xs text-muted">{row.label}</span>
                      ) : null}
                      {row.text ? (
                        <span className="text-tooltip-value text-text">{row.text}</span>
                      ) : (
                        <RollingNumber
                          value={row.value}
                          format={valueFormat.format}
                          suffix={valueFormat.suffix}
                          countUp={false}
                          className="text-tooltip-value text-text"
                        />
                      )}
                    </p>
                  ))}
                  {activePoint.note ? (
                    <p className={cn("text-xs", NOTE_TONES[activePoint.noteTone ?? "muted"])}>
                      {activePoint.note}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          {/* Axe X : le libellé actif passe en gras. */}
          <div aria-hidden="true" data-chart-axis className="relative mt-3 h-[15px] shrink-0">
            {points.map((point, index) =>
              index % xLabelEvery === 0 || index === points.length - 1 ? (
                <span
                  key={`${point.label}-${index}`}
                  style={{ left: `${fractionOf(index) * 100}%` }}
                  className={cn(
                    "absolute top-0 -translate-x-1/2 font-mono text-table-head whitespace-nowrap",
                    xMode === "edge" && index === 0 && "translate-x-0",
                    xMode === "edge" && index === points.length - 1 && "-translate-x-full",
                    active === index ? "font-bold text-text" : "font-normal text-muted",
                  )}
                >
                  {point.label}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>

      {/* Annonce du point parcouru au clavier. */}
      <p aria-live="polite" className="sr-only">
        {liveText}
      </p>

      {/* Alternative textuelle complète : la table des données. */}
      {/* Dans une boîte : un <table> ignore `overflow` et déborderait de la page. */}
      <div id={`${uid}-table`} className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Période</th>
              {seriesLabels.map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.label}-${index}`}>
                <th scope="row">{point.tooltipLabel ?? point.label}</th>
                {rowsByPoint[index]?.map((row) => (
                  <td key={row.label}>{row.text ?? formatChartValue(row.value, valueFormat)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/**
 * Change de graphique sans bouger le cadre (motion.md §2.4) : l'ancien s'efface vers le bas (200 ms),
 * le nouveau se dessine, même sur une page déjà vue.
 */
export function ChartSwap({ chartKey, children }: { chartKey: string; children: ReactNode }) {
  const preset = useMotionPreset();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={chartKey}
        initial={preset.swapIn.initial}
        animate={preset.swapIn.animate}
        exit={preset.swapOut}
      >
        <Replay>{children}</Replay>
      </motion.div>
    </AnimatePresence>
  );
}
