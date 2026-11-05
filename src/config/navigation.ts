import type { IconName } from "@/components/ui/icon";
import type { Permission } from "@/server/auth/permissions";

/**
 * Registre de navigation : source unique de la barre latérale et de ⌘K (figma-map §2.1).
 * 6 groupes, 17 entrées. Une entrée n'est affichée qu'aux utilisateurs autorisés : le contrôle
 * réel reste côté serveur, dans les pages et les services.
 */
export const NAV_KEYS = [
  "dashboard",
  "reporting",
  "messages",
  "clients",
  "pipeline",
  "quotes",
  "projects",
  "time",
  "sites",
  "contracts",
  "support",
  "finance",
  "team",
  "documents",
  "automations",
  "admin",
  "settings",
] as const;

export type NavKey = (typeof NAV_KEYS)[number];

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  icon: IconName;
  /** Au moins une de ces permissions est requise. Absent : tout membre de l'équipe. */
  permissions?: readonly Permission[];
  /** Préfixes de route qui marquent l'entrée active, si différents de `href`. */
  activePrefixes?: readonly string[];
}

export interface NavSection {
  key: string;
  label: string;
  items: readonly NavItem[];
}

export const NAVIGATION: readonly NavSection[] = [
  {
    key: "pilotage",
    label: "Pilotage",
    items: [
      {
        key: "dashboard",
        label: "Tableau de bord",
        href: "/",
        icon: "dashboard",
        permissions: ["dashboard:read"],
      },
      {
        key: "reporting",
        label: "Reporting",
        href: "/reporting",
        icon: "chart",
        permissions: ["dashboard:read"],
      },
    ],
  },
  {
    key: "commercial",
    label: "Commercial",
    items: [
      {
        key: "messages",
        label: "Messages",
        href: "/messages",
        icon: "messages",
        permissions: ["messages:read"],
      },
      {
        key: "clients",
        label: "Clients",
        href: "/clients",
        icon: "clients",
        permissions: ["crm:read"],
      },
      {
        key: "pipeline",
        label: "Pipeline",
        href: "/pipeline",
        icon: "pipeline",
        permissions: ["sales:read"],
      },
      {
        key: "quotes",
        label: "Devis",
        href: "/devis",
        icon: "devis",
        permissions: ["quotes:read"],
      },
    ],
  },
  {
    key: "production",
    label: "Production",
    items: [
      {
        key: "projects",
        label: "Projets",
        href: "/projets",
        icon: "projets",
        permissions: ["projects:read", "projects:read_assigned"],
      },
      {
        key: "time",
        label: "Temps et capacité",
        href: "/temps",
        icon: "clock",
        permissions: ["time:read", "time:create_own"],
      },
    ],
  },
  {
    key: "sites",
    label: "Sites et suivi",
    items: [
      {
        key: "sites",
        label: "Sites et CMS",
        href: "/sites",
        icon: "sites",
        permissions: ["sites:read"],
      },
      {
        key: "contracts",
        label: "Contrats",
        href: "/contrats",
        icon: "contrat",
        permissions: ["contracts:read"],
      },
      {
        key: "support",
        label: "Support",
        href: "/support",
        icon: "support",
        permissions: ["support:read", "support:read_assigned"],
      },
    ],
  },
  {
    key: "gestion",
    label: "Gestion",
    items: [
      {
        key: "finance",
        label: "Finances",
        href: "/finances",
        icon: "wallet",
        permissions: ["finance:read"],
      },
      { key: "team", label: "Équipe", href: "/equipe", icon: "equipe", permissions: ["team:read"] },
      {
        key: "documents",
        label: "Documents",
        href: "/documents",
        icon: "book",
        permissions: ["documents:read", "documents:read_assigned"],
      },
    ],
  },
  {
    key: "outils",
    label: "Outils",
    items: [
      {
        key: "automations",
        label: "Automatisations",
        href: "/automatisations",
        icon: "automatisations",
        permissions: ["automations:read"],
      },
      {
        key: "admin",
        label: "Administration",
        href: "/administration",
        icon: "shield",
        permissions: ["admin:read"],
      },
      {
        key: "settings",
        label: "Réglages",
        href: "/reglages/connexions",
        icon: "reglages",
        permissions: ["integrations:read"],
        activePrefixes: ["/reglages", "/profil"],
      },
    ],
  },
];

/** Navigation filtrée selon les droits de l'utilisateur (sections vides retirées). */
export function visibleNavigation(
  canSee: (permissions: readonly Permission[]) => boolean,
): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permissions || canSee(item.permissions)),
  })).filter((section) => section.items.length > 0);
}
