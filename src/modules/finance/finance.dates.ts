import type { BillingPeriod } from "@/lib/domain-enums";

/** Dates métier `AAAA-MM-JJ`, au calendrier de Paris. Fonctions pures, importables par l'interface. */
export interface DayRange {
  from: string;
  to: string;
}

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Le jour du calendrier à Paris pour cet instant : une facture échoit à minuit, heure de Paris. */
export function parisDay(now: Date): string {
  return PARIS_DAY.format(now);
}

function parts(day: string): { year: number; month: number; date: number } {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return { year, month, date };
}

function toDay(year: number, month: number, date: number): string {
  return new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);
}

/** Ajoute des mois, en restant dans le mois visé : 31 janvier + 1 mois donne le 28 ou 29 février. */
export function addMonths(day: string, months: number): string {
  const { year, month, date } = parts(day);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return toDay(year, month + months, Math.min(date, lastDay));
}

export function addDays(day: string, days: number): string {
  const { year, month, date } = parts(day);
  return toDay(year, month, date + days);
}

/** Jours écoulés de `from` à `to`, deux dates `AAAA-MM-JJ`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function monthOf(day: string): DayRange {
  const { year, month } = parts(day);
  return { from: toDay(year, month, 1), to: toDay(year, month + 1, 0) };
}

export const PERIOD_MONTHS: Record<BillingPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** Montant d'une période ramené au mois, arrondi au centime. */
export function monthlyCents(amountCents: number, period: BillingPeriod): number {
  return Math.round(amountCents / PERIOD_MONTHS[period]);
}

/**
 * Nombre d'échéances d'une récurrence commencée le `startOn` tombant dans `[from, to]` (bornes
 * incluses). Une dépense mensuelle née le 15 mars et lue du 1er avril au 31 mai compte 2 fois.
 */
export function countOccurrences(
  startOn: string,
  period: BillingPeriod,
  range: { from?: string | null; to: string },
): number {
  const step = PERIOD_MONTHS[period];
  let count = 0;
  for (let index = 0; ; index += 1) {
    const occurrence = addMonths(startOn, index * step);
    if (occurrence > range.to) break;
    if (!range.from || occurrence >= range.from) count += 1;
  }
  return count;
}

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const MONTH_YEAR_LABEL = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export interface MonthKey {
  /** `2026-11`. */
  key: string;
  /** « nov. ». */
  label: string;
  /** « novembre 2026 ». */
  longLabel: string;
  range: DayRange;
}

/** Les `count` derniers mois, le mois de `day` compris, du plus ancien au plus récent. */
export function lastMonths(day: string, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, index) => {
    const first = addMonths(monthOf(day).from, index - count + 1);
    const date = new Date(`${first}T00:00:00Z`);
    return {
      key: first.slice(0, 7),
      label: MONTH_LABEL.format(date),
      longLabel: MONTH_YEAR_LABEL.format(date),
      range: monthOf(first),
    };
  });
}
