import { marginPercent, percentOfCents } from "@/lib/money";

/**
 * Calculs d'un devis. Fichier pur, partagé par l'éditeur (aperçu immédiat) et le service, qui seul
 * fait foi : il recalcule tout à l'enregistrement et ne reprend jamais un total envoyé par le
 * navigateur.
 *
 * Une ligne récurrente (service du catalogue facturé chaque mois) s'affiche mais n'entre ni dans le
 * total HT, ni dans le coût, ni dans le temps du devis, comme sur l'écran 09.
 *
 * Le coût et le temps d'une ligne sont unitaires, comme son prix.
 */
export interface CalcLine {
  quantity: number;
  unitPriceCents: number;
  estimatedCostCents: number;
  estimatedMinutes: number;
  recurring: boolean;
}

export interface QuoteTotals {
  totalCents: number;
  estimatedCostCents: number;
  estimatedMinutes: number;
  /** Lignes récurrentes, hors total. */
  recurringCents: number;
}

export function computeTotals(lines: readonly CalcLine[]): QuoteTotals {
  const totals: QuoteTotals = {
    totalCents: 0,
    estimatedCostCents: 0,
    estimatedMinutes: 0,
    recurringCents: 0,
  };
  for (const line of lines) {
    const amount = line.quantity * line.unitPriceCents;
    if (line.recurring) {
      totals.recurringCents += amount;
      continue;
    }
    totals.totalCents += amount;
    totals.estimatedCostCents += line.quantity * line.estimatedCostCents;
    totals.estimatedMinutes += line.quantity * line.estimatedMinutes;
  }
  return totals;
}

export interface QuoteAmounts {
  totalCents: number;
  taxCents: number;
  totalWithTaxCents: number;
  depositCents: number;
  /** Marge estimée en %, `null` si le devis n'a pas encore de montant. */
  marginPercent: number | null;
}

export function computeAmounts(input: {
  totalCents: number;
  estimatedCostCents: number;
  taxPercent: number;
  depositPercent: number | null;
}): QuoteAmounts {
  const taxCents = percentOfCents(input.totalCents, input.taxPercent);
  return {
    totalCents: input.totalCents,
    taxCents,
    totalWithTaxCents: input.totalCents + taxCents,
    depositCents: percentOfCents(input.totalCents, input.depositPercent ?? 0),
    marginPercent: marginPercent(input.totalCents, input.estimatedCostCents),
  };
}
