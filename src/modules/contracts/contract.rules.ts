import type { BillingPeriod, ContractKind, TicketCategory } from "@/lib/domain-enums";

/**
 * Règles pures des contrats : périodes, normalisation mensuelle, quotas, catégories couvertes.
 * Sans dépendance serveur : les services les appliquent, l'interface peut s'en servir pour afficher.
 * Une date métier est une chaîne `AAAA-MM-JJ`, un jour du calendrier sans fuseau.
 */
const MONTHS_PER_PERIOD: Record<BillingPeriod, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Seuil d'alerte de consommation (arbitrage A7). */
export const QUOTA_ALERT_PERCENT = 80;

/** Fenêtre de renouvellement de l'écran 20 : « À renouveler (30 j) ». */
export const RENEWAL_WINDOW_DAYS = 30;

/** Un tarif sans révision depuis ce délai est à réévaluer (08.04.02). */
export const PRICE_REVIEW_MONTHS = 12;

/** Le jour du calendrier à Paris pour un instant donné. */
export function parisDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parseDay(day: string): { year: number; month: number; date: number } {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return { year, month, date };
}

function formatDay(year: number, month: number, date: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Ajoute des mois en gardant le jour d'ancrage : le 31 janvier + 1 mois donne le 28 février, et
 * + 2 mois le 31 mars, sans dérive.
 */
export function addMonths(day: string, months: number): string {
  const { year, month, date } = parseDay(day);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  return formatDay(targetYear, targetMonth, Math.min(date, daysInMonth(targetYear, targetMonth)));
}

export function addDays(day: string, days: number): string {
  const { year, month, date } = parseDay(day);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return formatDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Échéance suivante : `day` plus une période de facturation. */
export function addBillingPeriod(day: string, period: BillingPeriod): string {
  return addMonths(day, MONTHS_PER_PERIOD[period]);
}

export interface ContractPeriodWindow {
  /** Premier jour de la période, inclus. */
  start: string;
  /** Dernier jour de la période, inclus. */
  end: string;
}

function calendarPeriodStart(today: string, period: BillingPeriod): string {
  const { year, month } = parseDay(today);
  if (period === "monthly") return formatDay(year, month, 1);
  if (period === "yearly") return formatDay(year, 1, 1);
  const firstMonthOfQuarter = Math.floor((month - 1) / 3) * 3 + 1;
  return formatDay(year, firstMonthOfQuarter, 1);
}

/**
 * Période de quota contenant `today`. Elle suit l'anniversaire du début du contrat ; sans date de
 * début, le mois, le trimestre ou l'année civils. Avant le début du contrat : sa première période.
 */
export function periodWindow(
  contract: { startOn: string | null; period: BillingPeriod },
  today: string,
): ContractPeriodWindow {
  const months = MONTHS_PER_PERIOD[contract.period];
  const anchor = contract.startOn;
  if (!anchor) {
    const start = calendarPeriodStart(today, contract.period);
    return { start, end: addDays(addMonths(start, months), -1) };
  }

  let rank = 0;
  if (today > anchor) {
    const from = parseDay(anchor);
    const to = parseDay(today);
    const elapsed = (to.year - from.year) * 12 + (to.month - from.month);
    rank = Math.max(0, Math.floor(elapsed / months));
    // La fin de mois peut faire déborder l'estimation : on recule au besoin.
    while (rank > 0 && addMonths(anchor, rank * months) > today) rank -= 1;
    while (addMonths(anchor, (rank + 1) * months) <= today) rank += 1;
  }
  return {
    start: addMonths(anchor, rank * months),
    end: addDays(addMonths(anchor, (rank + 1) * months), -1),
  };
}

/** Prix ramené au mois, sans arrondi : les arrondis se font sur la somme, une seule fois. */
export function monthlyAmountCents(priceCents: number, period: BillingPeriod): number {
  return priceCents / MONTHS_PER_PERIOD[period];
}

/** Part consommée en pourcentage ; `null` quand le quota n'existe pas ou vaut 0. */
export function quotaPercent(consumed: number, included: number | null): number | null {
  if (included === null || included <= 0) return null;
  return (consumed / included) * 100;
}

export interface QuotaFigures {
  includedMinutes: number | null;
  consumedMinutes: number;
  includedTickets: number | null;
  consumedTickets: number;
}

/** Vrai si plus rien n'est disponible : la prochaine demande est hors forfait. */
export function quotaExhausted(figures: QuotaFigures): boolean {
  return (
    (figures.includedMinutes !== null && figures.consumedMinutes >= figures.includedMinutes) ||
    (figures.includedTickets !== null && figures.consumedTickets >= figures.includedTickets)
  );
}

/** Le plus consommé des deux quotas, en pourcentage ; `null` si aucun n'est mesurable. */
export function worstQuotaPercent(figures: QuotaFigures): number | null {
  const percents = [
    quotaPercent(figures.consumedMinutes, figures.includedMinutes),
    quotaPercent(figures.consumedTickets, figures.includedTickets),
  ].filter((value): value is number => value !== null);
  return percents.length > 0 ? Math.max(...percents) : null;
}

/** Vrai dès 80 % d'un des deux quotas (arbitrage A7). */
export function quotaReachedAlert(figures: QuotaFigures): boolean {
  const worst = worstQuotaPercent(figures);
  return worst !== null && worst >= QUOTA_ALERT_PERCENT;
}

/** Vrai si la consommation dépasse strictement un quota. Un quota de 0 est dépassé dès 1. */
export function quotaExceeded(figures: QuotaFigures): boolean {
  return (
    (figures.includedMinutes !== null && figures.consumedMinutes > figures.includedMinutes) ||
    (figures.includedTickets !== null && figures.consumedTickets > figures.includedTickets)
  );
}

/**
 * Ce que chaque type de contrat couvre. Une évolution n'est couverte par aucun : elle se transforme
 * en demande de changement ou en devis (08.01.02, 09.04.02).
 */
export const COVERED_CATEGORIES: Record<ContractKind, readonly TicketCategory[]> = {
  hosting: ["incident", "question"],
  maintenance: ["incident", "bug", "assistance", "question"],
  support: ["incident", "bug", "assistance", "question"],
  accompaniment: ["assistance", "question"],
};

export function categoryCovered(kind: ContractKind, category: TicketCategory): boolean {
  return COVERED_CATEGORIES[kind].includes(category);
}

/** La plus proche de deux dates facultatives. */
export function earliest(a: string | null, b: string | null): string | null {
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

/** Prochain anniversaire de facturation après `today`, sans dépasser la fin du contrat. */
export function nextAutoRenewal(
  startOn: string,
  period: BillingPeriod,
  today: string,
  endOn: string | null,
): string {
  const next = addDays(periodWindow({ startOn, period }, today).end, 1);
  return earliest(next, endOn) ?? next;
}

/** Date de la prochaine échéance : renouvellement, sinon fin du contrat. */
export function nextDeadline(contract: {
  renewsOn: string | null;
  endOn: string | null;
}): string | null {
  return contract.renewsOn ?? contract.endOn;
}
