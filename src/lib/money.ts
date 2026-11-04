/**
 * Montants HT en centimes entiers, devise EUR (`docs/domain-model.md` §2).
 * Fonctions pures, utilisables côté serveur et côté client. Aucun calcul en virgule flottante
 * n'est stocké : on arrondit au centime dès qu'un pourcentage intervient.
 */
const LOCALE = "fr-FR";
const EMPTY = "—";

const WHOLE = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const WITH_CENTS = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface MoneyFormatOptions {
  /** `auto` (défaut) : centimes affichés seulement s'il y en a. `always` : 2 décimales. */
  cents?: "auto" | "always" | "never";
}

/** `780000` donne « 7 800 € », `123450` « 1 234,50 € ». Valeur absente : « — ». */
export function formatCents(
  cents: number | null | undefined,
  options: MoneyFormatOptions = {},
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return EMPTY;
  const mode = options.cents ?? "auto";
  const showCents = mode === "always" || (mode === "auto" && cents % 100 !== 0);
  return (showCents ? WITH_CENTS : WHOLE).format(cents / 100);
}

/** « 7 800 € HT ». */
export function formatCentsHT(
  cents: number | null | undefined,
  options: MoneyFormatOptions = {},
): string {
  const formatted = formatCents(cents, options);
  return formatted === EMPTY ? EMPTY : `${formatted} HT`;
}

/** Écart signé : « +12 € », « −12 € », « 0 € ». */
export function formatCentsSigned(
  cents: number | null | undefined,
  options: MoneyFormatOptions = {},
): string {
  const formatted = formatCents(
    cents === null || cents === undefined ? cents : Math.abs(cents),
    options,
  );
  if (formatted === EMPTY || !cents) return formatted;
  return `${cents > 0 ? "+" : "−"}${formatted}`;
}

export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

export function centsToEuros(cents: number): number {
  return cents / 100;
}

/**
 * Lit une saisie française ou anglaise : « 1 234,50 », « 1234.5 », « 1 234 € ».
 * `null` si la saisie n'est pas un montant.
 */
export function parseEurosToCents(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[\s  €]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return eurosToCents(Number(cleaned));
}

/** Somme de montants, en ignorant les valeurs absentes. */
export function sumCents(values: readonly (number | null | undefined)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** Part d'un montant, arrondie au centime : acompte de 30 %, TVA à 20 %. */
export function percentOfCents(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

/** Pourcentage de `part` dans `total` (0 à 100 ou plus). `null` si `total` vaut 0 : non calculable. */
export function ratioPercent(part: number, total: number): number | null {
  return total === 0 ? null : (part / total) * 100;
}

/**
 * Taux de marge : `(revenus − coûts) / revenus`. `null` sans revenu.
 * Le calcul métier de la marge reste `getMargin` (`src/modules/finance/profitability.service.ts`).
 */
export function marginPercent(revenueCents: number, costCents: number): number | null {
  return ratioPercent(revenueCents - costCents, revenueCents);
}
