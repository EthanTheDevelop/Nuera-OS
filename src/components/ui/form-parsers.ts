import { MINUTES_PER_DAY } from "@/lib/format";

/** Conversion d'une saisie de durée vers les minutes du contrat de domaine (domain-model §2). */

/**
 * « 90 », « 90 min », « 1h30 », « 1 h », « 1,5 h », « 0,5 j » → minutes.
 * Un nombre seul se lit en minutes. `null` si la saisie n'est pas une durée.
 */
export function parseDurationToMinutes(
  input: string,
  minutesPerDay = MINUTES_PER_DAY,
): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, "");
  if (text === "") return null;

  const hoursMinutes = /^(\d+)h(\d{1,2})?(?:min)?$/.exec(text);
  if (hoursMinutes) {
    const minutes = Number(hoursMinutes[2] ?? 0);
    if (minutes >= 60) return null;
    return Number(hoursMinutes[1]) * 60 + minutes;
  }

  const unit = /^(\d+(?:[.,]\d+)?)(min|m|h|j)?$/.exec(text);
  if (!unit?.[1]) return null;
  const value = Number(unit[1].replace(",", "."));
  const factor = unit[2] === "h" ? 60 : unit[2] === "j" ? minutesPerDay : 1;
  return Math.round(value * factor);
}
