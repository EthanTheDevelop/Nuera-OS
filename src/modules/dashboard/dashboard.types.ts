import type { DashboardLayout, LayoutTile, TileKey } from "./dashboard.tiles";

/**
 * Ce qu'une tuile affiche : données sérialisables, déjà formatées au fuseau de Paris par le service.
 * L'interface choisit combien en montrer selon le format, sans rien recalculer.
 */
export type TileTone = "accent" | "success" | "warn" | "danger" | "neutral" | "chatgpt";
export type TileNoteTone = "muted" | "warn" | "danger" | "success";

export interface TileBadge {
  label: string;
  tone: TileTone;
}

export interface TileGaugeView {
  percent: number;
  /** Ton fixe. Sans lui, `scale` applique les seuils de l'arbitrage A7 à `scaleValue`. */
  tone?: "accent" | "success" | "warn" | "danger";
  scale?: "load" | "budget";
  /** Valeur réelle, au-delà de 100 % : la jauge plafonne, pas le seuil. */
  scaleValue?: number;
  valueText: string;
}

export interface TileRow {
  id: string;
  label: string;
  detail?: string;
  /** À droite, en mono. */
  value?: string;
  href?: string;
  gauge?: TileGaugeView;
  badge?: TileBadge;
  /** Pastille `MAR 10:00`. */
  dateChip?: string;
  /** Initiales d'un avatar. */
  initials?: string;
  /** Point d'état. */
  dot?: "success" | "warn" | "danger" | "neutral";
  /** « Réponse suggérée prête ». */
  suggestion?: boolean;
  tone?: TileNoteTone;
}

export type TileRowStyle = "plain" | "gauge" | "avatar" | "date" | "dot" | "badge";

/** Chiffre de la tuile : un nombre roule, un texte s'affiche tel quel. */
export type TileFigureView =
  | { kind: "euros"; value: number; suffix?: string }
  | { kind: "number"; value: number; suffix?: string }
  | { kind: "text"; text: string };

export interface RevenueChartView {
  points: { label: string; tooltipLabel: string; note?: string; noteTone?: TileNoteTone }[];
  projects: number[];
  recurring: number[];
}

export interface TileEmptyView {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
}

export interface TileView {
  figure: TileFigureView;
  /** À droite du chiffre : `journées prévues`. */
  unit?: string;
  note?: string;
  noteTone?: TileNoteTone;
  badge?: TileBadge;
  /** Titre remplacé par la donnée : « Frais 50/50 » à deux associés. */
  title?: string;
  rowStyle?: TileRowStyle;
  rows?: TileRow[];
  /**
   * Quand les lignes remplacent le chiffre (maquette 01) : `always` hors 1×1, `tall` à partir de deux
   * rangées, `short` sur une seule rangée. Sans valeur, le chiffre reste.
   */
  rowsFirst?: "always" | "tall" | "short";
  /** Les lignes n'apparaissent qu'à partir de deux rangées : la jauge occupe déjà la première. */
  rowsWhenTall?: boolean;
  /** Charge en pourcentage : badge et ton suivent les seuils de l'arbitrage A7. */
  loadPercent?: number;
  gauge?: TileGaugeView;
  chart?: RevenueChartView;
  /** Base vide : le format 1×1 garde le chiffre, les autres disent quoi faire. */
  empty?: TileEmptyView;
  /** Âge lisible d'une lecture externe périmée. */
  stale?: string;
  /** Une partie des sources n'a pas répondu. */
  partial?: string;
}

export type TileState =
  | { status: "ready"; view: TileView }
  | { status: "error" }
  | { status: "unavailable"; service: string; message: string };

export interface DashboardData {
  layout: DashboardLayout;
  /** Tuiles que ce compte peut ajouter, hors tableau. */
  gallery: LayoutTile[];
  tiles: Partial<Record<TileKey, TileState>>;
}
