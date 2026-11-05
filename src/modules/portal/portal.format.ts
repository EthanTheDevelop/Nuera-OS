import type { BadgeTone } from "@/components/ui/badge";
import type { TicketStatus } from "@/lib/domain-enums";
import { formatDateShort, formatRelativeDate } from "@/lib/format";

/** Fonctions pures du portail, sans accès aux données : testées à part. */

/** « Hugo et Camille », « Hugo, Camille et Léa ». Sans personne : l'agence. */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "Nuera Studio";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

export const firstNameOf = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? "";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jours entiers d'aujourd'hui (à Paris) jusqu'à une date `YYYY-MM-DD`. */
export function daysUntil(day: string, now: Date = new Date()): number {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** « 18 novembre », sans l'année. */
export function formatDayMonth(day: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function deliveryPromise(
  dueOn: string,
  now: Date = new Date(),
): { label: string; onTime: boolean } {
  const days = daysUntil(dueOn, now);
  if (days > 1) return { label: `Dans ${days} jours · dans les temps`, onTime: true };
  if (days === 1) return { label: "Demain", onTime: true };
  if (days === 0) return { label: "Aujourd'hui", onTime: true };
  return { label: "Date dépassée · nous revenons vers vous", onTime: false };
}

/**
 * État d'une demande en mots de client. « Qualifiée » est un état de travail de l'agence : pour le
 * client, sa demande reste reçue jusqu'à la prise en charge.
 */
export function clientTicketStatus(status: TicketStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case "received":
    case "qualified":
      return { label: "Reçue", tone: "accent" };
    case "in_progress":
      return { label: "En cours", tone: "warn" };
    case "resolved":
      return { label: "Faite", tone: "success" };
    case "closed":
      return { label: "Clôturée", tone: "neutral" };
  }
}

/** Frise d'une demande : un état n'y paraît qu'une fois, le premier passage fait foi. */
export function clientTicketTimeline(
  rows: readonly { status: TicketStatus; at: Date }[],
): { label: string; at: Date }[] {
  const out: { label: string; at: Date }[] = [];
  for (const row of rows) {
    const { label } = clientTicketStatus(row.status);
    if (out[out.length - 1]?.label !== label) out.push({ label, at: row.at });
  }
  return out;
}

export function ticketDateLabel(row: {
  status: TicketStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}): string {
  if ((row.status === "resolved" || row.status === "closed") && row.resolvedAt) {
    return `faite le ${formatDateShort(row.resolvedAt)}`;
  }
  return `envoyée ${formatRelativeDate(row.createdAt)}`;
}

/** « iPhone · Safari », d'après l'en-tête : un repère pour le client, sans valeur de preuve. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Appareil inconnu";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "PC"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "Appareil";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Navigateur";
  return `${device} · ${browser}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

function icsInstant(value: Date): string {
  return (
    `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T` +
    `${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`
  );
}

function icsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fichier agenda (RFC 5545) d'un rendez-vous. Les textes sont échappés : ils viennent de la base. */
export function buildAppointmentIcs(input: {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  location: string | null;
  now?: Date;
}): string {
  const end = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nuera Studio//Espace client//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.id}@nuera.studio`,
    `DTSTAMP:${icsInstant(input.now ?? new Date())}`,
    `DTSTART:${icsInstant(input.startsAt)}`,
    `DTEND:${icsInstant(end)}`,
    `SUMMARY:${icsText(input.title)}`,
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
