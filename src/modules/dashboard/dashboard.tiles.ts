import type { IconName } from "@/components/ui/icon";
import type { Permission } from "@/server/auth/permissions";

/**
 * Catalogue des tuiles du tableau de bord (écrans 01 et 06). Fichier pur : le service y lit les
 * permissions et les formats autorisés, l'interface les titres et les icônes.
 */
export const TILE_SIZES = ["1x1", "2x1", "2x2", "4x2"] as const;
export type DashboardTileSize = (typeof TILE_SIZES)[number];

export const TILE_KEYS = [
  "revenue",
  "pipeline",
  "load",
  "mrr",
  "collected",
  "overdue",
  "shared_costs",
  "messages",
  "appointments",
  "sites",
  "quotes",
  "support",
  "priorities",
  "alerts",
  "overview",
  "late_projects",
  "time_vs_quote",
  "subscriptions",
  "missing_content",
  "invoices",
  "automations",
  "treasury",
  "monthly_report",
  "projects_progress",
  "projects_risk",
  "weekly_load",
] as const;
export type TileKey = (typeof TILE_KEYS)[number];

export interface TileDefinition {
  key: TileKey;
  title: string;
  icon: IconName;
  /** Format de départ, celui de la maquette. */
  size: DashboardTileSize;
  /** Formats dans l'ordre où la poignée les parcourt. */
  sizes: readonly DashboardTileSize[];
  /** Toutes requises. Sans l'une d'elles, la tuile n'existe pas pour ce compte. */
  permissions: readonly Permission[];
  href: string | null;
  /** Présente sur le tableau d'un nouveau compte (écran 01). */
  onDefaultBoard: boolean;
}

const STANDARD: readonly DashboardTileSize[] = ["1x1", "2x1", "2x2"];
const FINANCE: readonly Permission[] = ["finance:read"];

const tile = (
  key: TileKey,
  title: string,
  icon: IconName,
  size: DashboardTileSize,
  permissions: readonly Permission[],
  href: string | null,
  options: { sizes?: readonly DashboardTileSize[]; onDefaultBoard?: boolean } = {},
): TileDefinition => ({
  key,
  title,
  icon,
  size,
  permissions,
  href,
  sizes: options.sizes ?? STANDARD,
  onDefaultBoard: options.onDefaultBoard ?? false,
});

const onBoard = { onDefaultBoard: true };

/** Ordre de la maquette 01, puis ce que le cadrage exige et que Figma ne dessine pas. */
export const TILE_CATALOG: readonly TileDefinition[] = [
  tile("revenue", "Chiffre d’affaires", "euro", "4x2", FINANCE, "/finances", {
    sizes: ["1x1", "2x1", "2x2", "4x2"],
    onDefaultBoard: true,
  }),
  tile("pipeline", "Pipeline", "pipeline", "2x2", ["sales:read"], "/pipeline", onBoard),
  tile("load", "Charge du mois", "clock", "2x1", ["time:read"], "/temps", onBoard),
  tile("mrr", "MRR", "euro", "1x1", FINANCE, "/contrats", onBoard),
  tile("collected", "Encaissé", "check", "1x1", FINANCE, "/finances", onBoard),
  tile("overdue", "En retard", "clock", "1x1", ["tasks:read"], "/projets", onBoard),
  tile("shared_costs", "Frais partagés", "link", "1x1", FINANCE, "/finances/couts", onBoard),
  tile(
    "messages",
    "Messages à traiter",
    "messages",
    "2x2",
    ["messages:read"],
    "/messages",
    onBoard,
  ),
  tile(
    "appointments",
    "Prochains rendez-vous",
    "calendar",
    "2x1",
    ["messages:read"],
    "/messages/rendez-vous",
    onBoard,
  ),
  tile("sites", "État des sites", "server", "2x1", ["sites:read"], "/sites", onBoard),
  tile("quotes", "Devis à signer", "devis", "2x1", ["quotes:read"], "/devis", onBoard),
  tile("support", "Demandes", "support", "1x1", ["support:read"], "/support", onBoard),
  tile("priorities", "Priorités du jour", "flag", "2x2", [], null, onBoard),
  tile("alerts", "Alertes", "alert", "2x2", [], null, onBoard),
  tile("overview", "Vue d’ensemble", "dashboard", "2x2", [], null, onBoard),
  tile(
    "late_projects",
    "Projets en retard",
    "projets",
    "1x1",
    ["projects:read"],
    "/projets?vue=en-retard",
  ),
  tile(
    "time_vs_quote",
    "Temps passé / devis",
    "clock",
    "2x1",
    ["projects:read", "time:read"],
    "/temps",
  ),
  tile("subscriptions", "Abonnements", "contrat", "2x1", ["contracts:read"], "/contrats"),
  tile("missing_content", "Contenus manquants", "paperclip", "2x1", ["projects:read"], "/projets"),
  tile("invoices", "Factures Indy", "wallet", "2x2", FINANCE, "/finances"),
  tile(
    "automations",
    "Automatisations n8n",
    "automatisations",
    "2x1",
    ["automations:read"],
    "/automatisations",
  ),
  tile("treasury", "Trésorerie", "wallet", "2x1", FINANCE, "/finances"),
  tile("monthly_report", "Rapport mensuel", "chart", "2x2", FINANCE, "/reporting"),
  tile(
    "projects_progress",
    "Avancement des projets",
    "projets",
    "2x2",
    ["projects:read"],
    "/projets",
  ),
  tile("projects_risk", "Projets à risque", "alert", "2x2", ["projects:read"], "/projets"),
  tile("weekly_load", "Charge à 6 semaines", "clock", "2x2", ["time:read"], "/temps"),
];

const BY_KEY = new Map(TILE_CATALOG.map((definition) => [definition.key, definition]));

export function tileDefinition(key: TileKey): TileDefinition {
  const definition = BY_KEY.get(key);
  if (!definition) throw new Error(`Tuile inconnue : ${key}`);
  return definition;
}

export interface LayoutTile {
  key: TileKey;
  size: DashboardTileSize;
}

export interface DashboardLayout {
  tiles: LayoutTile[];
}

/** Format suivant au clic sur la poignée : petite, moyenne, grande, puis on recommence. */
export function nextTileSize(key: TileKey, size: DashboardTileSize): DashboardTileSize {
  const { sizes } = tileDefinition(key);
  const index = sizes.indexOf(size);
  return sizes[(index + 1) % sizes.length] ?? size;
}

/** Déplace une entrée d'une liste : déplacement au clavier et au glisser partagent cette règle. */
export function moveTile(tiles: readonly LayoutTile[], key: TileKey, to: number): LayoutTile[] {
  const from = tiles.findIndex((item) => item.key === key);
  if (from < 0) return [...tiles];
  const target = Math.max(0, Math.min(tiles.length - 1, to));
  const next = [...tiles];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
}
