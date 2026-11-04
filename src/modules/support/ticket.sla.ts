import type { TicketStatus } from "@/lib/domain-enums";

/**
 * Délais de support (domain-model §3, cadrage §4.09). Fonctions pures, sans dépendance serveur :
 * l'interface et le service calculent le même retard.
 *
 * Les heures contractuelles comptent en heures calendaires, depuis l'ouverture de la demande : le
 * contrat ne décrit pas d'heures ouvrées.
 */
const HOUR_MS = 3_600_000;

export interface TicketSla {
  responseHours: number | null;
  resolutionHours: number | null;
}

/** Échéance de la demande : première réponse tant qu'elle n'est pas donnée, puis résolution. */
export function computeDueAt(openedAt: Date, sla: TicketSla, firstResponseAt: Date | null) {
  const at = (hours: number) => new Date(openedAt.getTime() + hours * HOUR_MS);
  const resolution = sla.resolutionHours === null ? null : at(sla.resolutionHours);
  if (firstResponseAt || sla.responseHours === null) return resolution;
  const response = at(sla.responseHours);
  return resolution && resolution < response ? resolution : response;
}

export function hasContractualSla(sla: TicketSla | null | undefined): boolean {
  return sla != null && (sla.responseHours !== null || sla.resolutionHours !== null);
}

const OPEN_STATUSES: readonly TicketStatus[] = ["received", "qualified", "in_progress"];

export function isTicketOpen(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Une demande résolue ou clôturée n'est plus en retard, même si son échéance est passée. */
export function isTicketOverdue(
  ticket: { status: TicketStatus; dueAt: Date | null },
  now: Date = new Date(),
): boolean {
  return ticket.dueAt !== null && isTicketOpen(ticket.status) && ticket.dueAt < now;
}

/** Écart entre l'heure de Paris et UTC à cet instant, en millisecondes. */
function parisOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - at.getTime();
}

/** Une échéance saisie à la journée (`AAAA-MM-JJ`) tombe à 23:59 à Paris. */
export function endOfParisDay(day: string): Date {
  const utc = new Date(`${day}T23:59:00Z`);
  return new Date(utc.getTime() - parisOffsetMs(utc));
}

/** Premier instant du mois en cours à Paris. */
export function startOfParisMonth(now: Date): Date {
  const utc = new Date(`${parisDay(now).slice(0, 7)}-01T00:00:00Z`);
  return new Date(utc.getTime() - parisOffsetMs(utc));
}

/** Jour à Paris (`AAAA-MM-JJ`) d'un instant, pour préremplir un champ date. */
export function parisDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
