import { parseDurationToMinutes } from "@/components/ui/form-parsers";
import { formatMinutes, MINUTES_PER_DAY } from "@/lib/format";

/** Saisies courtes du temps : fichier pur, partagé par la feuille de temps et le simulateur. */

const BARE_NUMBER = /^\d+(?:[.,]\d+)?$/;

/**
 * Cellule de feuille de temps : un nombre seul se lit en heures (« 3 », « 2,5 »), comme dans la colonne.
 * Vide : 0, la cellule est effacée. `null` si la saisie n'est pas une durée.
 */
export function parseCellDuration(input: string): number | null {
  const text = input.trim();
  if (text === "" || text === "—") return 0;
  if (BARE_NUMBER.test(text)) return Math.round(Number(text.replace(",", ".")) * 60);
  return parseDurationToMinutes(text);
}

export function formatCellDuration(minutes: number): string {
  return minutes > 0 ? formatMinutes(minutes) : "";
}

/**
 * Charge d'un projet à simuler : un nombre seul se lit en journées (« 15 »), comme sur la carte.
 * `null` si vide ou illisible.
 */
export function parseChargeDuration(input: string): number | null {
  const text = input.trim();
  if (text === "") return null;
  if (BARE_NUMBER.test(text)) return Math.round(Number(text.replace(",", ".")) * MINUTES_PER_DAY);
  return parseDurationToMinutes(text);
}

/** `S45 · 90 %`, ou `S45 · —` sans capacité. */
export function weekBarLabel(label: string, percent: number | null): string {
  return percent === null ? `${label} · —` : `${label} · ${percent} %`;
}

/** Prénom d'un nom complet, pour les notes courtes (`Nezar 24 h`). */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
