import type { CSSProperties } from "react";
import { GrowBar } from "@/components/motion/grow-bar";
import { cn } from "@/lib/cn";

export type GaugeTone = "accent" | "success" | "warn" | "danger" | "chatgpt";

const FILL: Record<GaugeTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warn: "bg-warn",
  danger: "bg-danger",
  chatgpt: "bg-chatgpt",
};

/** Arbitrage A7, charge : `warn` à partir de 90 %, `danger` au-dessus de 100 %. */
export function loadTone(percent: number): GaugeTone {
  if (percent > 100) return "danger";
  if (percent >= 90) return "warn";
  return "accent";
}

/** Arbitrage A7, consommation de budget ou de forfait : alerte à 80 %. */
export function budgetTone(percent: number): GaugeTone {
  if (percent > 100) return "danger";
  if (percent >= 80) return "warn";
  return "accent";
}

/**
 * Jauge (Figma 58:334) : hauteur 5 ou 8, rayon 2,5, rail `--surface-raised`.
 * Se remplit de gauche à droite par `scaleX` (600 ms). Compatible serveur.
 * `label` est obligatoire : la jauge seule ne dit rien à un lecteur d'écran.
 */
export function Gauge({
  value,
  max = 100,
  tone = "accent",
  height = 5,
  label,
  valueText,
  showValue = false,
  index = 0,
  className,
}: {
  value: number;
  max?: number;
  tone?: GaugeTone;
  height?: 5 | 8;
  label: string;
  /** Valeur annoncée (`78 %`, `14 sur 18 journées`). */
  valueText?: string;
  /** Affiche `valueText` à droite de la barre (sinon il n'est que annoncé). */
  showValue?: boolean;
  /** Rang dans une cascade de jauges. */
  index?: number;
  className?: string;
}) {
  const bar = (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.max(0, Math.min(value, max))}
      aria-valuetext={valueText}
      className={cn(
        "w-full overflow-hidden rounded-gauge bg-surface-raised",
        height === 5 ? "h-[5px]" : "h-2",
        showValue && valueText ? "min-w-0 flex-1" : className,
      )}
    >
      <GrowBar
        value={max > 0 ? value / max : 0}
        index={index}
        className={cn("h-full", FILL[tone])}
      />
    </div>
  );
  if (!showValue || !valueText) return bar;
  return (
    <div className={cn("flex w-full items-center gap-3", className)}>
      {bar}
      <span aria-hidden="true" className="shrink-0 text-xs text-text tabular-nums">
        {valueText}
      </span>
    </div>
  );
}

/**
 * Jauge à segments (note M3, Figma 141:6814) : 40 segments de 9 × 20, gap 3, rayon 2.
 * Les segments se remplissent un à un, de gauche à droite, 25 ms d'écart. Compatible serveur.
 */
export function SegmentedGauge({
  value,
  max = 100,
  tone = "accent",
  segments = 40,
  label,
  valueText,
  index = 0,
  className,
}: {
  value: number;
  max?: number;
  tone?: GaugeTone;
  segments?: number;
  label: string;
  valueText?: string;
  /** Décalage de départ, en segments : les jauges d'une fenêtre se remplissent l'une après l'autre. */
  index?: number;
  className?: string;
}) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  // Une valeur non nulle se voit toujours, même minuscule (0,1 % d'erreurs dans M3).
  const filled = value > 0 ? Math.max(1, Math.round(ratio * segments)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.max(0, Math.min(value, max))}
      aria-valuetext={valueText}
      className={cn("flex w-full gap-[3px]", className)}
    >
      {Array.from({ length: segments }, (_, segment) => (
        <span
          key={segment}
          aria-hidden="true"
          className="relative h-5 min-w-px flex-1 overflow-hidden rounded-tab bg-border"
        >
          {segment < filled ? (
            <span
              className={cn("anim-segment absolute inset-0", FILL[tone])}
              style={{ "--i": index + segment } as CSSProperties}
            />
          ) : null}
        </span>
      ))}
    </div>
  );
}
