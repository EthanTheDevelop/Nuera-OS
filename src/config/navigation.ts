import { House, type LucideIcon } from "lucide-react";
import type { Permission } from "@/server/auth/permissions";

/**
 * Registre de navigation — source unique des entrées de la sidebar.
 *
 * Point d'extension des modules : un module métier ajoute ici sa section / son entrée,
 * avec la permission de lecture requise. L'entrée n'est affichée qu'aux utilisateurs
 * autorisés (le contrôle réel reste côté serveur, dans les pages et services).
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Permission requise pour voir l'entrée. Absente = tout utilisateur connecté. */
  permission?: Permission;
}

export interface NavSection {
  key: string;
  /** Titre de section (facultatif). */
  label?: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    key: "main",
    items: [{ key: "home", label: "Accueil", href: "/", icon: House }],
  },
];

/** Navigation filtrée selon les permissions de l'utilisateur (sections vides retirées). */
export function visibleNavigation(canSee: (permission: Permission) => boolean): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || canSee(item.permission)),
  })).filter((section) => section.items.length > 0);
}
