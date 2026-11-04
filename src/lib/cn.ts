import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Tailles de texte nommées de `src/app/globals.css`. Sans cette liste, tailwind-merge prend
 * `text-cell` pour une couleur et le retire dès qu'une vraie couleur (`text-muted`) le suit.
 * Toute nouvelle taille s'ajoute ici : `cn.test.ts` vérifie que la liste est complète.
 */
export const TEXT_SIZE_TOKENS = [
  "ui",
  "page-title",
  "page-subtitle",
  "figure-hero",
  "figure",
  "kpi-label",
  "kpi-note",
  "tile-title",
  "badge",
  "avatar",
  "table-head",
  "row-primary",
  "row-secondary",
  "cell",
  "amount-compact",
  "counter",
  "nav",
  "nav-search",
  "nav-group",
  "kbd",
  "nav-counter",
  "user-title",
  "user-detail",
  "field-label",
  "field",
  "window-title",
  "tooltip-value",
  "compact-button",
  "logo-os",
  "eyebrow",
  "client-title",
  "client-lead",
  "client-date",
  "client-card-title",
  "client-card-body",
  "client-action-title",
  "client-action-detail",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...TEXT_SIZE_TOKENS],
      radius: ["gauge", "tab"],
      shadow: ["soft", "float", "menu", "capsule", "capsule-tab"],
    },
  },
});

/** Compose des classes Tailwind en résolvant les conflits (`px-2` puis `px-4` → `px-4`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
