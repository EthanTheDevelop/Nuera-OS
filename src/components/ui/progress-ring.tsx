import { cn } from "@/lib/cn";

export type RingStep = "done" | "current" | "todo";

const CENTER = 14;
const RADIUS = 11;
/** Écart entre deux quarts (en degrés), arrondi de trait compris : celui de Figma (153:6949). */
const GAP_DEGREES = 10;

function arcPath(startDeg: number, endDeg: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CENTER + RADIUS * Math.cos(rad), CENTER + RADIUS * Math.sin(rad)] as const;
  };
  const [x1, y1] = point(startDeg);
  const [x2, y2] = point(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${x1.toFixed(3)} ${y1.toFixed(3)}A${RADIUS} ${RADIUS} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;
}

/**
 * Anneau d'avancement (Figma 153:6949), 28 px : un arc par étape, fait / en cours / à venir.
 * `onDark` (capsule client) : tokens `*-on-dark`. Compatible serveur.
 * `label` porte l'information : l'anneau seul ne dit rien à un lecteur d'écran.
 */
export function ProgressRing({
  steps,
  size = 28,
  onDark = false,
  label,
  className,
}: {
  steps: readonly RingStep[];
  size?: number;
  onDark?: boolean;
  label?: string;
  className?: string;
}) {
  const sweep = 360 / Math.max(1, steps.length);
  const color: Record<RingStep, string> = onDark
    ? {
        done: "var(--success-on-dark)",
        current: "var(--warn-on-dark)",
        todo: "var(--border-on-dark)",
      }
    : { done: "var(--success)", current: "var(--en-cours)", todo: "var(--border)" };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0", className)}
    >
      {steps.map((step, index) => (
        <path
          key={index}
          d={arcPath(index * sweep + GAP_DEGREES / 2, (index + 1) * sweep - GAP_DEGREES / 2)}
          stroke={color[step]}
          strokeWidth="3"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
