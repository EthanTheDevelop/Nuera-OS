import type { Database } from "@/server/db/types";

export type MarginScope = "project" | "client" | "site" | "contract";

/** Bornes incluses, dates `AAAA-MM-JJ`. */
export interface MarginPeriod {
  from: string;
  to: string;
}

export interface GetMarginInput {
  scope: MarginScope;
  id: string;
  /** Absente : toute la vie de l'objet. */
  period?: MarginPeriod;
}

/** Une colonne du calcul. Montants HT en centimes. */
export interface MarginFigures {
  revenueCents: number;
  /** `minutes × hourly_cost_cents` figé à la saisie. */
  timeCostCents: number;
  minutes: number;
  directCostCents: number;
  totalCostCents: number;
  /** `revenueCents − totalCostCents`. */
  marginCents: number;
  /** NULL sans revenu : non calculable, jamais 0. */
  marginPercent: number | null;
}

/** Prévisionnel et réalisé restent séparés : ils ne s'additionnent jamais. */
export interface MarginBreakdown {
  scope: MarginScope;
  id: string;
  period: MarginPeriod | null;
  forecast: MarginFigures;
  actual: MarginFigures;
}

/**
 * Source unique du calcul de marge : `marge HT = revenus HT attribués − coûts directs attribués`,
 * coût du temps inclus. Tableau de bord, projet, fiche client et finances appellent cette fonction
 * et rien d'autre. Réservé à `finance:read` : à vérifier par le service appelant.
 */
export async function getMargin(_db: Database, _input: GetMarginInput): Promise<MarginBreakdown> {
  throw new Error("getMargin n'est pas implémenté : à livrer par le lot Finances.");
}
