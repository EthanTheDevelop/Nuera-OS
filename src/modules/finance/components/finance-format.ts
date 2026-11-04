import type { GaugeTone } from "@/components/ui/gauge";

/** Format `Intl` d'un montant affiché par `RollingNumber` : centimes seulement s'il y en a. */
export function euroFormat(cents: number) {
  return {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  } as const;
}

/** Prénom d'un associé, pour la colonne ÉMISE PAR. */
export function firstName(fullName: string | null): string {
  return fullName?.split(/\s+/)[0] ?? "—";
}

/** D'après la maquette 21 : verte à partir de 60 %, ambre en dessous, rouge si la marge est négative. */
export function marginTone(percent: number): GaugeTone {
  if (percent < 0) return "danger";
  return percent >= 60 ? "success" : "warn";
}
