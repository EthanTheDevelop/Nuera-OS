"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { BUILD_MS, DURATION_MS, EASE } from "@/lib/motion";
import { pageBuildElapsedMs } from "./build-state";
import { useIsClientPreset, useStyleNonce } from "./motion-provider";

const LOCALE = "fr-FR";

const bezier = (points: readonly number[]) => `cubic-bezier(${points.join(", ")})`;
const TIMING = { duration: DURATION_MS.line, easing: bezier(EASE.out) };
const OPACITY_TIMING = { duration: DURATION_MS.fast, easing: "ease-out" };

/**
 * Chiffre qui roule (motion.md §2.2) : chaque chiffre à sa place, les unités à la fin.
 * Le HTML du serveur porte la vraie valeur : jamais de faux zéro si le JavaScript manque.
 * À l'arrivée d'une page, compte depuis 0 ; ensuite, roule d'une valeur à l'autre.
 * Portail client et `prefers-reduced-motion` : la valeur s'affiche sans rouler.
 *
 * `format` : options d'Intl.NumberFormat (`{ style: "currency", currency: "EUR" }`…).
 * Les montants en centimes se convertissent avant : ce composant affiche ce qu'on lui donne.
 */
export function RollingNumber({
  value,
  format,
  prefix,
  suffix,
  countUp = true,
  className,
}: {
  value: number;
  format?: Format;
  prefix?: string;
  suffix?: string;
  /** `false` : pas de décompte à l'arrivée (info-bulle, compteur de menu). */
  countUp?: boolean;
  className?: string;
}) {
  const nonce = useStyleNonce();
  const client = useIsClientPreset();
  const reduced = useReducedMotion() ?? false;
  const animated = !client && !reduced;
  // Pendant la remise à zéro invisible qui précède le décompte. Ensuite, `value` s'affiche et roule.
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    const elapsed = pageBuildElapsedMs();
    if (!countUp || !animated || elapsed === null || elapsed >= BUILD_MS.data) return;
    // La couche « données » est encore masquée : le zéro ne se voit pas.
    const reset = window.setTimeout(() => setCounting(true), 0);
    const count = window.setTimeout(() => setCounting(false), BUILD_MS.data - elapsed);
    return () => {
      window.clearTimeout(reset);
      window.clearTimeout(count);
    };
    // Décidé une fois, au montage : les changements suivants roulent d'eux-mêmes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className={cn("inline-block", countUp && "anim-data", className)}>
      <NumberFlow
        value={counting ? 0 : value}
        locales={LOCALE}
        format={format}
        prefix={prefix}
        suffix={suffix}
        nonce={nonce}
        animated={animated && !counting}
        respectMotionPreference
        transformTiming={TIMING}
        spinTiming={TIMING}
        opacityTiming={OPACITY_TIMING}
      />
    </span>
  );
}
