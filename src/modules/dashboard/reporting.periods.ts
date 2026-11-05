import { addMonths, monthOf, type DayRange } from "@/modules/finance/finance.dates";

/**
 * Périodes du reporting, au calendrier de Paris. Fichier pur, importable par l'interface.
 * Une période en cours se compare à la précédente de même nature ; le graphique à la même période
 * de l'année d'avant.
 */
export const PERIOD_KEYS = [
  "mois",
  "mois-dernier",
  "trimestre",
  "trimestre-dernier",
  "annee",
  "annee-derniere",
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  mois: "Ce mois",
  "mois-dernier": "Mois dernier",
  trimestre: "Ce trimestre",
  "trimestre-dernier": "Trimestre dernier",
  annee: "Cette année",
  "annee-derniere": "Année dernière",
};

export const GRANULARITIES = ["mois", "trimestre", "annee"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  mois: "Mois",
  trimestre: "Trimestre",
  annee: "Année",
};

const BUCKET_COUNT: Record<Granularity, number> = { mois: 6, trimestre: 4, annee: 3 };
const BUCKET_MONTHS: Record<Granularity, number> = { mois: 1, trimestre: 3, annee: 12 };

const MONTH_LONG = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_ONLY = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const MONTH_SHORT_YEAR = new Intl.DateTimeFormat("fr-FR", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase("fr-FR") + text.slice(1);
}

const yearOf = (day: string) => day.slice(0, 4);
const quarterOf = (day: string) => Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;

function quarterRange(day: string): DayRange {
  const startMonth = (quarterOf(day) - 1) * 3 + 1;
  const from = `${yearOf(day)}-${String(startMonth).padStart(2, "0")}-01`;
  return { from, to: monthOf(addMonths(from, 2)).to };
}

function yearRange(day: string): DayRange {
  return { from: `${yearOf(day)}-01-01`, to: `${yearOf(day)}-12-31` };
}

export interface ReportingPeriod {
  key: PeriodKey;
  range: DayRange;
  previous: DayRange;
  /** « Novembre 2026 ». */
  label: string;
  /** « octobre ». */
  previousLabel: string;
}

function monthLabel(day: string) {
  return capitalize(MONTH_LONG.format(asDate(day)));
}

/** Période nommée, relative à aujourd'hui. Une clé inconnue retombe sur le mois en cours. */
export function resolvePeriod(key: PeriodKey, today: string): ReportingPeriod {
  switch (key) {
    case "mois-dernier":
    case "mois": {
      const anchor = key === "mois" ? today : addMonths(today, -1);
      const range = monthOf(anchor);
      const previous = monthOf(addMonths(range.from, -1));
      return {
        key,
        range,
        previous,
        label: monthLabel(range.from),
        previousLabel: MONTH_ONLY.format(asDate(previous.from)),
      };
    }
    case "trimestre-dernier":
    case "trimestre": {
      const anchor = key === "trimestre" ? today : addMonths(today, -3);
      const range = quarterRange(anchor);
      const previous = quarterRange(addMonths(range.from, -3));
      return {
        key,
        range,
        previous,
        label: `T${quarterOf(range.from)} ${yearOf(range.from)}`,
        previousLabel: `T${quarterOf(previous.from)} ${yearOf(previous.from)}`,
      };
    }
    case "annee-derniere":
    case "annee": {
      const anchor = key === "annee" ? today : addMonths(today, -12);
      const range = yearRange(anchor);
      const previous = yearRange(addMonths(range.from, -12));
      return {
        key,
        range,
        previous,
        label: yearOf(range.from),
        previousLabel: yearOf(previous.from),
      };
    }
  }
}

export interface Bucket {
  key: string;
  /** Libellé d'axe : `Juin`, `T3`, `2026`. */
  label: string;
  /** Libellé d'info-bulle : `OCT. 2026`. */
  tooltipLabel: string;
  range: DayRange;
}

/** Cases d'un graphique, de la plus ancienne à celle qui contient `endDay`. */
export function buildBuckets(granularity: Granularity, endDay: string): Bucket[] {
  const months = BUCKET_MONTHS[granularity];
  const count = BUCKET_COUNT[granularity];
  const anchor =
    granularity === "mois"
      ? monthOf(endDay).from
      : granularity === "trimestre"
        ? quarterRange(endDay).from
        : yearRange(endDay).from;
  return Array.from({ length: count }, (_, index) => {
    const from = addMonths(anchor, (index - count + 1) * months);
    if (granularity === "mois") {
      return {
        key: from.slice(0, 7),
        label: capitalize(MONTH_SHORT.format(asDate(from))),
        tooltipLabel: MONTH_SHORT_YEAR.format(asDate(from)),
        range: monthOf(from),
      };
    }
    if (granularity === "trimestre") {
      return {
        key: `${yearOf(from)}-T${quarterOf(from)}`,
        label: `T${quarterOf(from)}`,
        tooltipLabel: `T${quarterOf(from)} ${yearOf(from)}`,
        range: quarterRange(from),
      };
    }
    return {
      key: yearOf(from),
      label: yearOf(from),
      tooltipLabel: yearOf(from),
      range: yearRange(from),
    };
  });
}

/** La même case, un an plus tôt. */
export function sameBucketLastYear(bucket: Bucket): DayRange {
  return { from: addMonths(bucket.range.from, -12), to: addMonths(bucket.range.to, -12) };
}

/** Les mois (`AAAA-MM`) d'un intervalle : une case réunit les lignes mensuelles qu'elle couvre. */
export function monthsIn(range: DayRange): string[] {
  const months: string[] = [];
  let cursor = monthOf(range.from).from;
  while (cursor <= range.to) {
    months.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
  }
  return months;
}

/** Écart en pourcentage. NULL sans base de comparaison : pas de faux « +100 % ». */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Un instant de fin de journée à Paris : une lecture « à cette date » inclut toute la journée. */
export function endOfParisDay(day: string, now: Date): Date {
  const at = new Date(`${day}T21:00:00Z`);
  return at > now ? now : at;
}
