/**
 * Formats d'affichage fr-FR : durées, dates, dates relatives, nombres.
 * Fonctions pures et isomorphes : le fuseau est fixé (Europe/Paris) pour qu'un rendu serveur et un
 * rendu client donnent le même texte, quel que soit le fuseau de la machine.
 *
 * Une date métier est une chaîne `AAAA-MM-JJ` (colonne `date`) : un jour du calendrier, sans fuseau.
 * Un instant est un `Date` ou une chaîne ISO complète (colonne `timestamptz`).
 */
const LOCALE = "fr-FR";
const TIME_ZONE = "Europe/Paris";
const EMPTY = "—";
const NBSP = " ";

/** Journée de référence pour convertir des minutes en jours : 7 h. */
export const MINUTES_PER_DAY = 420;

export type DateInput = Date | string | null | undefined;

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ResolvedDate {
  date: Date;
  /** `UTC` pour un jour du calendrier (stocké à minuit UTC), sinon Europe/Paris. */
  timeZone: string;
}

function resolve(value: DateInput): ResolvedDate | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && CALENDAR_DAY.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : { date, timeZone: "UTC" };
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : { date, timeZone: TIME_ZONE };
}

function format(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  const resolved = resolve(value);
  if (!resolved) return EMPTY;
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: resolved.timeZone }).format(
    resolved.date,
  );
}

// --- Durées ------------------------------------------------------------------------------------

/** `90` donne « 1 h 30 », `60` « 1 h », `45` « 45 min ». Durées stockées en minutes. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EMPTY;
  const sign = minutes < 0 ? "−" : "";
  const total = Math.abs(Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${sign}${rest}${NBSP}min`;
  if (rest === 0) return `${sign}${hours}${NBSP}h`;
  return `${sign}${hours}${NBSP}h${NBSP}${String(rest).padStart(2, "0")}`;
}

/** `630` donne « 1,5 j » (journées de 7 h par défaut, voir `MINUTES_PER_DAY`). */
export function formatDays(
  minutes: number | null | undefined,
  minutesPerDay: number = MINUTES_PER_DAY,
): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EMPTY;
  const days = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1 }).format(
    minutes / minutesPerDay,
  );
  return `${days}${NBSP}j`;
}

// --- Dates -------------------------------------------------------------------------------------

/** « 18 novembre 2026 ». */
export function formatDate(value: DateInput): string {
  return format(value, { day: "numeric", month: "long", year: "numeric" });
}

/** « 18 nov. », « 1er nov. » */
export function formatDateShort(value: DateInput): string {
  return format(value, { day: "numeric", month: "short" }).replace(/^1(?=\s)/, "1er");
}

/** « 18/11/2026 ». */
export function formatDateNumeric(value: DateInput): string {
  return format(value, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** « mardi 3 novembre 2026 ». */
export function formatDateLong(value: DateInput): string {
  return format(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** « 14:05 », à l'heure de Paris. */
export function formatTime(value: DateInput): string {
  return format(value, { hour: "2-digit", minute: "2-digit" });
}

/** « 18 nov. 2026, 14:05 », à l'heure de Paris. */
export function formatDateTime(value: DateInput): string {
  return format(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Numéro du jour du calendrier (à Paris pour un instant), pour comparer deux dates à la journée. */
function dayNumber(resolved: ResolvedDate): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolved.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(resolved.date);
  return Date.parse(`${parts}T00:00:00Z`) / 86_400_000;
}

const RELATIVE = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** Écart en jours du calendrier entre `value` et `now` : négatif dans le passé. `null` si absent. */
export function daysFromNow(value: DateInput, now: Date = new Date()): number | null {
  const resolved = resolve(value);
  if (!resolved) return null;
  return dayNumber(resolved) - dayNumber({ date: now, timeZone: TIME_ZONE });
}

/** « aujourd'hui », « hier », « dans 15 jours », « il y a 2 mois ». À la journée près. */
export function formatRelativeDate(value: DateInput, now: Date = new Date()): string {
  const days = daysFromNow(value, now);
  if (days === null) return EMPTY;
  const abs = Math.abs(days);
  if (abs < 31) return RELATIVE.format(days, "day");
  if (abs < 365) return RELATIVE.format(Math.trunc(days / 30), "month");
  return RELATIVE.format(Math.trunc(days / 365), "year");
}

/** « à l'instant », « il y a 5 min », « il y a 2 h », puis comme `formatRelativeDate`. */
export function formatRelativeTime(value: DateInput, now: Date = new Date()): string {
  const resolved = resolve(value);
  if (!resolved) return EMPTY;
  const seconds = Math.round((resolved.date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "à l'instant";
  if (abs < 3600) {
    const count = Math.round(abs / 60);
    return seconds < 0 ? `il y a ${count}${NBSP}min` : `dans ${count}${NBSP}min`;
  }
  if (abs < 86_400) {
    const count = Math.round(abs / 3600);
    return seconds < 0 ? `il y a ${count}${NBSP}h` : `dans ${count}${NBSP}h`;
  }
  return formatRelativeDate(value, now);
}

// --- Nombres -----------------------------------------------------------------------------------

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat("fr-CA", { maximumFractionDigits }).format(value);
}

/** `78` donne « 78 % » : la valeur est déjà en pourcentage. Valeur absente : « — ». */
export function formatPercent(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `${formatNumber(value, maximumFractionDigits)}${NBSP}%`;
}
