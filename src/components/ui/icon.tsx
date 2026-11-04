import type { SVGProps } from "react";
import { cn } from "@/lib/cn";
import { FIGMA_ICONS } from "./icon-paths";

/**
 * Icônes hors section Figma, dessinées au même trait pour les besoins du responsive
 * (ouvrir et fermer le tiroir de navigation). Elles n'existent pas dans le fichier.
 */
const EXTRA_ICONS = {
  menu: [{ d: "M4 7H20M4 12H20M4 17H20" }],
  close: [{ d: "M6 6L18 18M18 6L6 18" }],
} as const;

const ICONS = { ...FIGMA_ICONS, ...EXTRA_ICONS };

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/**
 * Icône du Design System : tracés exacts de Figma, couleur héritée (`currentColor`).
 * Décorative par défaut. Avec `label`, elle est annoncée aux lecteurs d'écran.
 * Taille Figma selon l'usage : 18 (menu), 16 (pastille, bouton compact), 14, 12.
 */
export function Icon({
  name,
  size = 18,
  label,
  className,
  ...props
}: {
  name: IconName;
  size?: number;
  label?: string;
} & Omit<SVGProps<SVGSVGElement>, "name" | "children">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
      {...props}
    >
      {ICONS[name].map((shape) => (
        <path key={shape.d} d={shape.d} />
      ))}
    </svg>
  );
}
