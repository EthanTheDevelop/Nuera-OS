import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * Barre qui pousse depuis sa base, par `transform` uniquement (motion.md §3).
 * L'échelle finale est dans le HTML : sans JavaScript, la valeur est juste. Une valeur qui change
 * ensuite roule par transition. Compatible serveur.
 *
 * `value` : proportion de 0 à 1 (bornée).
 */
export function GrowBar({
  value,
  axis = "x",
  index = 0,
  className,
  downward = false,
}: {
  value: number;
  axis?: "x" | "y";
  index?: number;
  className?: string;
  /** Axe vertical uniquement : pousse vers le bas (barres « perdues »). */
  downward?: boolean;
}) {
  const scale = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const style = {
    transform: axis === "x" ? `scaleX(${scale})` : `scaleY(${scale})`,
    "--i": index,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "value-transition block",
        axis === "x" && "anim-grow-x origin-left",
        axis === "y" && (downward ? "anim-grow-y-down origin-top" : "anim-grow-y origin-bottom"),
        className,
      )}
    />
  );
}
