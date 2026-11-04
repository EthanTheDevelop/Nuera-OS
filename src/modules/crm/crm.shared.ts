import { createHash } from "node:crypto";
import { ConflictError, type FieldErrors } from "@/server/errors";

/**
 * Outils communs aux services CRM et ventes : lignes du jeu d'essai, identifiants rejouables,
 * normalisations. Les lignes `seed-` n'ont aucune fiche dans Twenty : y écrire échoue honnêtement.
 */
export const SEED_TWENTY_ID_PREFIX = "seed-";

export function isSeedTwentyId(twentyId: string | null | undefined): boolean {
  return Boolean(twentyId?.startsWith(SEED_TWENTY_ID_PREFIX));
}

/** Refuse d'appeler Twenty pour une fiche du jeu d'essai, qui n'y existe pas. */
export function assertCrmWritable(twentyId: string | null | undefined): void {
  if (isSeedTwentyId(twentyId)) {
    throw new ConflictError(
      "Cette fiche vient du jeu d'essai : elle n'existe pas dans Twenty et ne peut pas y être modifiée.",
    );
  }
}

/**
 * UUID déterministe, de même forme qu'un UUID v5 : deux appels avec les mêmes parties donnent le
 * même identifiant. Une reprise d'import ou de création liée ne peut donc pas créer de doublon.
 */
export function deriveUuid(...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const variant = ((parseInt(hash.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

/** Clé de comparaison d'un nom : sans accent, sans casse, sans ponctuation. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const E164 = /^\+[1-9]\d{4,14}$/;

/**
 * Téléphone au format international exigé par Twenty. Un numéro français national
 * (`06 12 34 56 78`) est converti. `null` : saisie inexploitable.
 */
export function toE164Phone(input: string): string | null {
  const compact = input.replace(/[\s.()-]/g, "");
  if (E164.test(compact)) return compact;
  if (compact.startsWith("00") && E164.test(`+${compact.slice(2)}`)) return `+${compact.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(compact)) return `+33${compact.slice(1)}`;
  return null;
}

/** Une date métier saisie (`AAAA-MM-JJ`) posée à midi UTC : le même jour à Paris, quelle que soit l'heure d'été. */
export function dayToInstant(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

export type DuplicateField = "domain" | "email" | "siren" | "name" | "phone";

/** Fiche existante en conflit : ce que l'interface propose, restaurer ou fusionner, jamais recréer. */
export interface DuplicateInfo {
  entity: "company" | "contact";
  field: DuplicateField;
  /** Absent : la fiche n'existe que dans Twenty, archivée. */
  id: string | null;
  twentyId: string | null;
  name: string | null;
  companyId: string | null;
  archived: boolean;
  /** Un homonyme peut être une fiche distincte : « Créer quand même » reste possible. */
  soft: boolean;
}

export class DuplicateRecordError extends ConflictError {
  constructor(
    message: string,
    fieldErrors: FieldErrors,
    readonly duplicate: DuplicateInfo,
  ) {
    super(message, fieldErrors);
  }
}
