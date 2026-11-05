import type { IconName } from "@/components/ui/icon";
import type { Permission } from "@/server/auth/permissions";

/**
 * Catalogue des tuiles du tableau de bord (écrans 01 et 06). Fichier pur : le service y lit les
 * permissions et les formats autorisés, l'interface les titres et les icônes.
 */
export const TILE_SIZES = ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3", "3x1", "3x2", "3x3"] as const;
export type DashboardTileSize = (typeof TILE_SIZES)[number];

/** Plus grand côté d'une tuile, en colonnes comme en rangées. */
export const TILE_MAX_SPAN = 3;

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
  /** Toutes requises. Sans l'une d'elles, la tuile n'existe pas pour ce compte. */
  permissions: readonly Permission[];
  href: string | null;
  /** Présente sur le tableau d'un nouveau compte (écran 01). */
  onDefaultBoard: boolean;
}

const FINANCE: readonly Permission[] = ["finance:read"];

const tile = (
  key: TileKey,
  title: string,
  icon: IconName,
  size: DashboardTileSize,
  permissions: readonly Permission[],
  href: string | null,
  options: { onDefaultBoard?: boolean } = {},
): TileDefinition => ({
  key,
  title,
  icon,
  size,
  permissions,
  href,
  onDefaultBoard: options.onDefaultBoard ?? false,
});

const onBoard = { onDefaultBoard: true };

/** Ordre de la maquette 01, puis ce que le cadrage exige et que Figma ne dessine pas. */
export const TILE_CATALOG: readonly TileDefinition[] = [
  tile("revenue", "Chiffre d’affaires", "euro", "3x2", FINANCE, "/finances", onBoard),
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

/**
 * Format lu en base : un ancien format ou un côté hors bornes se ramène à 1..3 (`4x2` devient `3x2`),
 * et ce qui ne se lit pas retombe sur le format de départ de la tuile.
 */
export function upgradeTileSize(value: unknown, fallback: DashboardTileSize): DashboardTileSize {
  const match = typeof value === "string" ? /^(\d+)x(\d+)$/.exec(value) : null;
  if (!match) return fallback;
  const side = (text: string | undefined) =>
    Math.max(1, Math.min(TILE_MAX_SPAN, Number(text))) as 1 | 2 | 3;
  return `${side(match[1])}x${side(match[2])}`;
}

/** Colonnes et lignes d'un format, bornées à la largeur de la grille (3×2 tient sur 2 colonnes). */
export function tileSpan(size: DashboardTileSize, gridColumns: number) {
  const [columns = 1, rows = 1] = size.split("x").map(Number);
  return { columns: Math.min(columns, gridColumns), rows };
}

export interface TilePlacement {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

/**
 * Place les tuiles comme `grid-auto-flow: row dense` : chacune au premier trou où elle tient, en
 * lisant la grille de gauche à droite, de haut en bas (lignes et colonnes comptées à partir de 1).
 */
export function packTiles(
  tiles: readonly LayoutTile[],
  gridColumns: number,
): Map<TileKey, TilePlacement> {
  const taken = new Set<string>();
  const placements = new Map<TileKey, TilePlacement>();
  for (const { key, size } of tiles) {
    const { columns, rows } = tileSpan(size, gridColumns);
    const cells = (column: number, row: number) =>
      Array.from({ length: columns * rows }, (_, index) => {
        return `${column + (index % columns)}:${row + Math.floor(index / columns)}`;
      });
    placing: for (let row = 1; ; row += 1) {
      for (let column = 1; column <= gridColumns - columns + 1; column += 1) {
        const wanted = cells(column, row);
        if (wanted.some((cell) => taken.has(cell))) continue;
        wanted.forEach((cell) => taken.add(cell));
        placements.set(key, { column, row, columns, rows });
        break placing;
      }
    }
  }
  return placements;
}

/** Cases libres de la grille, plus une rangée en réserve sous les tuiles pour pouvoir s'y poser. */
export function emptyCells(
  placements: ReadonlyMap<TileKey, TilePlacement>,
  gridColumns: number,
): { column: number; row: number }[] {
  const taken = new Set<string>();
  let lastRow = 0;
  for (const { column, row, columns, rows } of placements.values()) {
    lastRow = Math.max(lastRow, row + rows - 1);
    for (let y = row; y < row + rows; y += 1) {
      for (let x = column; x < column + columns; x += 1) taken.add(`${x}:${y}`);
    }
  }
  const cells: { column: number; row: number }[] = [];
  for (let row = 1; row <= lastRow + 1; row += 1) {
    for (let column = 1; column <= gridColumns; column += 1) {
      if (!taken.has(`${column}:${row}`)) cells.push({ column, row });
    }
  }
  return cells;
}

/** Copie de la liste, la tuile insérée au rang donné. */
export function insertTile(
  others: readonly LayoutTile[],
  tile: LayoutTile,
  at: number,
): LayoutTile[] {
  return [...others.slice(0, at), tile, ...others.slice(at)];
}

/**
 * Rang où insérer une tuile pour qu'elle se pose au plus près de la case visée (fractions comprises).
 * Le tableau n'enregistre qu'un ordre et des formats : seules les places qu'un ordre permet comptent.
 * Le rang en cours garde un léger avantage, et le moins de chamboulement départage les égalités.
 */
export function closestInsertion(
  others: readonly LayoutTile[],
  tile: LayoutTile,
  target: { column: number; row: number },
  gridColumns: number,
  current: number | null,
): number {
  let best = current ?? others.length;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let at = 0; at <= others.length; at += 1) {
    const spot = packTiles(insertTile(others, tile, at), gridColumns).get(tile.key);
    if (!spot) continue;
    const distance = (spot.column - target.column) ** 2 + (spot.row - target.row) ** 2;
    const score =
      distance -
      (at === current ? 0.25 : 0) +
      (current === null ? 0 : Math.abs(at - current) * 0.001);
    if (score < bestScore) {
      best = at;
      bestScore = score;
    }
  }
  return best;
}

/** Format voisin aux flèches, une dimension à la fois et sans boucler : 1 et 3 restent les bouts. */
export function stepTileSize(
  size: DashboardTileSize,
  axis: "columns" | "rows",
  step: -1 | 1,
): DashboardTileSize {
  const { columns, rows } = tileSpan(size, TILE_MAX_SPAN);
  const next = `${axis === "columns" ? columns + step : columns}x${axis === "rows" ? rows + step : rows}`;
  return TILE_SIZES.find((candidate) => candidate === next) ?? size;
}

/**
 * Format le plus proche de l'étendue visée par la poignée, en colonnes et lignes (fractions
 * comprises). À égalité, le format en cours reste : sans déplacement, rien ne change, même quand la
 * grille borne la largeur.
 */
export function nearestTileSize(
  current: DashboardTileSize,
  target: { columns: number; rows: number },
  gridColumns: number,
): DashboardTileSize {
  const distance = (size: DashboardTileSize) => {
    const span = tileSpan(size, gridColumns);
    return (span.columns - target.columns) ** 2 + (span.rows - target.rows) ** 2;
  };
  return TILE_SIZES.reduce<DashboardTileSize>(
    (best, size) => (distance(size) < distance(best) ? size : best),
    current,
  );
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
