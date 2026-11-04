/**
 * Calendrier du temps et de la capacité : jours métier `AAAA-MM-JJ`, sans fuseau, et semaines ISO.
 * Fichier pur, importable côté interface. « Aujourd'hui » est le jour de l'agence, à Paris.
 */
const TIME_ZONE = "Europe/Paris";
const MS_PER_DAY = 86_400_000;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

export interface DayRange {
  from: string;
  to: string;
}

function toUtc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function fromUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * MS_PER_DAY);
}

/** 1 pour lundi, 7 pour dimanche. */
export function dayOfWeek(day: string): number {
  const weekday = new Date(toUtc(day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function isWorkingDay(day: string): boolean {
  return dayOfWeek(day) <= 5;
}

/** Lundi de la semaine de ce jour. */
export function weekStart(day: string): string {
  return addDays(day, 1 - dayOfWeek(day));
}

export function weekEnd(day: string): string {
  return addDays(weekStart(day), 6);
}

/** Numéro de semaine ISO 8601 : la semaine 1 contient le premier jeudi de l'année. */
export function isoWeek(day: string): { year: number; week: number } {
  const thursday = addDays(weekStart(day), 3);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor((toUtc(thursday) - Date.UTC(year, 0, 1)) / (7 * MS_PER_DAY)) + 1;
  return { year, week };
}

/** `2026-W45`, pour l'URL. */
export function weekKey(day: string): string {
  const { year, week } = isoWeek(day);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** `S45`, libellé d'écran. */
export function weekLabel(day: string): string {
  return `S${isoWeek(day).week}`;
}

/** Lundi d'une semaine `2026-W45` ; `null` si la clé n'existe pas (URL trafiquée). */
export function parseWeekKey(key: string | null | undefined): string | null {
  const match = WEEK_KEY.exec(key ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  // Le 4 janvier est toujours en semaine 1.
  const monday = addDays(weekStart(`${year}-01-04`), (week - 1) * 7);
  return weekKey(monday) === key ? monday : null;
}

export function monthRange(day: string): DayRange {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return {
    from: fromUtc(Date.UTC(year, month - 1, 1)),
    to: fromUtc(Date.UTC(year, month, 0)),
  };
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let time = toUtc(from); time <= toUtc(to); time += MS_PER_DAY) days.push(fromUtc(time));
  return days;
}

/** Jour réel au format attendu : les bornes d'une URL ou d'un formulaire ne sont pas fiables. */
export function isCalendarDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(toUtc(value)) &&
    fromUtc(toUtc(value)) === value
  );
}
