import { sql } from "drizzle-orm";
import { sequences } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Numéros lisibles (`D-2026-014`), comptés par préfixe et par année.
 *
 * `INSERT … ON CONFLICT DO UPDATE` pose un verrou sur la ligne du compteur jusqu'à la fin de la
 * transaction : deux créations simultanées s'attendent, ne reçoivent jamais le même numéro, et une
 * transaction annulée rend le sien. À appeler avec la transaction de la création.
 */
export const SEQUENCE_PREFIXES = {
  quote: "D",
  project: "P",
  ticket: "T",
  contract: "C",
  task: "TA",
} as const;

export type SequenceScope = keyof typeof SEQUENCE_PREFIXES;

/** Année civile à Paris : le numéro du 1er janvier à 00:30 appartient à la nouvelle année. */
export function sequenceYear(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(now),
  );
}

export function formatSequenceNumber(scope: SequenceScope, year: number, value: number): string {
  return `${SEQUENCE_PREFIXES[scope]}-${year}-${String(value).padStart(3, "0")}`;
}

/** Valeur suivante du compteur `(scope, year)`, à partir de 1. */
export async function nextSequenceValue(
  tx: Database,
  scope: SequenceScope,
  year: number,
): Promise<number> {
  const [row] = await tx
    .insert(sequences)
    .values({ scope, year, value: 1 })
    .onConflictDoUpdate({
      target: [sequences.scope, sequences.year],
      set: { value: sql`${sequences.value} + 1`, updatedAt: new Date() },
    })
    .returning({ value: sequences.value });
  if (!row) throw new Error(`Compteur ${scope}/${year} non mis à jour.`);
  return row.value;
}

/** Numéro suivant, prêt à enregistrer : `nextNumber(tx, "quote")` donne `D-2026-014`. */
export async function nextNumber(
  tx: Database,
  scope: SequenceScope,
  now: Date = new Date(),
): Promise<string> {
  const year = sequenceYear(now);
  return formatSequenceNumber(scope, year, await nextSequenceValue(tx, scope, year));
}
