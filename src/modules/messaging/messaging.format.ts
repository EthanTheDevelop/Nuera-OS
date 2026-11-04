import { daysFromNow, formatDateShort, formatTime } from "@/lib/format";
import type { MessageView } from "./message.service";

const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "Europe/Paris" });

function capitalize(text: string): string {
  return `${text.charAt(0).toLocaleUpperCase("fr-FR")}${text.slice(1)}`;
}

/** Heure d'une ligne de conversation (écran 02) : `9:42`, `Hier`, `Lun.`, `28 oct.` */
export function formatInboxTime(value: Date | null, now: Date = new Date()): string {
  if (!value) return "";
  const days = daysFromNow(value, now) ?? 0;
  if (days === 0) return formatTime(value);
  if (days === -1) return "Hier";
  if (days > -7 && days < 0) return capitalize(WEEKDAY.format(value));
  return formatDateShort(value);
}

/** Heure d'une signature de message : `9:42`, `Ven. 16:10`, `28 oct. 16:10`. */
export function formatMessageTime(value: Date, now: Date = new Date()): string {
  const days = daysFromNow(value, now) ?? 0;
  if (days === 0) return formatTime(value);
  if (days > -7 && days < 0) return `${capitalize(WEEKDAY.format(value))} ${formatTime(value)}`;
  return `${formatDateShort(value)} ${formatTime(value)}`;
}

/** Prochain rendez-vous du panneau : `jeu. 20 nov. 10:00`. */
export function formatPanelDateTime(value: Date): string {
  return `${WEEKDAY.format(value)} ${formatDateShort(value)} ${formatTime(value)}`;
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Taille lisible d'une pièce jointe. */
export function formatFileSize(bytes: number | null): string | undefined {
  if (bytes === null) return undefined;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

/** Message affichable : les libellés de date sont calculés côté serveur, à l'heure de Paris. */
export interface ThreadMessage extends MessageView {
  signature: string;
}

export function toThreadMessage(message: MessageView, now: Date = new Date()): ThreadMessage {
  const time = formatMessageTime(message.at, now);
  return { ...message, signature: `${firstNameOf(message.authorName)} · ${time}` };
}
