import type { FinancialDocumentKind, FinancialDocumentStatus } from "@/lib/domain-enums";
import { parseEurosToCents } from "@/lib/money";

/**
 * Lecture d'un fichier de factures issu d'Indy. Indy ne documente pas publiquement le format d'un
 * export de factures (vérifié le 2026-11-04 sur indy.fr et wikicompta.indy.fr) : rien n'est supposé
 * sur les colonnes, l'utilisateur les associe lui-même. Les suggestions ne reposent que sur des
 * libellés français courants. Fonctions pures, sans accès réseau.
 */

export const IMPORT_FIELDS = [
  "externalRef",
  "company",
  "siren",
  "amountHt",
  "amountTtc",
  "tax",
  "issuedOn",
  "dueOn",
  "status",
  "paidOn",
  "issuer",
  "project",
  "contract",
  "kind",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Champ → intitulé de colonne du fichier. Une colonne absente laisse le champ vide. */
export type ColumnMapping = Partial<Record<ImportField, string>>;

export interface CsvRecord {
  /** Numéro de ligne dans le fichier, en-tête comprise : celui que l'utilisateur retrouve. */
  line: number;
  cells: string[];
}

export interface ParsedCsv {
  delimiter: string;
  headers: string[];
  records: CsvRecord[];
}

/** Lit l'UTF-8 (avec ou sans BOM), sinon le Windows-1252 d'un fichier enregistré depuis Excel. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const DELIMITERS = [";", ",", "\t"] as const;

/** Séparateur le plus fréquent de la première ligne, hors guillemets. */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "\n" || char === "\r")) break;
    if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best: string = DELIMITERS[0];
  for (const [delimiter, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

/** RFC 4180 : guillemets doublés, retours à la ligne dans une cellule, fin de ligne CR, LF ou CRLF. */
export function parseCsv(text: string): ParsedCsv {
  const source = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(source);
  const rows: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    cell = "";
    // Une ligne entièrement vide n'est pas un enregistrement.
    if (cells.some((value) => value.trim() !== "")) {
      rows.push({ line: recordLine, cells: cells.map((value) => value.trim()) });
    }
    cells = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += char;
    }
  }
  if (cell !== "" || cells.length > 0) endRecord();

  const [head, ...records] = rows;
  return { delimiter, headers: head?.cells ?? [], records };
}

/** Sans accents ni ponctuation, en minuscules : « Date d'échéance » donne `date d echeance`. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Libellés courants, du plus précis au plus général : le premier champ servi garde sa colonne. */
const SYNONYMS: readonly (readonly [ImportField, readonly string[]])[] = [
  [
    "externalRef",
    [
      "numero de facture",
      "n de facture",
      "numero facture",
      "reference",
      "numero",
      "ref",
      "facture",
    ],
  ],
  [
    "company",
    ["raison sociale", "nom du client", "client", "societe", "entreprise", "destinataire"],
  ],
  ["siren", ["siren", "siret"]],
  ["amountHt", ["montant ht", "total ht", "ht", "montant hors taxes", "montant"]],
  ["amountTtc", ["montant ttc", "total ttc", "ttc"]],
  ["tax", ["montant tva", "total tva", "tva"]],
  ["dueOn", ["date d echeance", "date echeance", "echeance", "a payer avant"]],
  ["paidOn", ["date de paiement", "date paiement", "payee le", "paye le", "reglee le"]],
  ["issuedOn", ["date d emission", "date emission", "emise le", "date de facture", "date"]],
  ["status", ["statut", "etat", "state", "status"]],
  ["issuer", ["emise par", "emis par", "emetteur", "associe", "auteur"]],
  ["project", ["numero de projet", "projet"]],
  ["contract", ["numero de contrat", "contrat"]],
  ["kind", ["type de document", "type"]],
];

/** Propose une association champ → colonne. L'utilisateur la corrige avant l'import. */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  const normalized = headers.map((header) => ({ header, key: normalize(header) }));
  for (const [field, labels] of SYNONYMS) {
    for (const label of labels) {
      const match = normalized.find(({ header, key }) => key === label && !taken.has(header));
      if (match) {
        mapping[field] = match.header;
        taken.add(match.header);
        break;
      }
    }
  }
  return mapping;
}

/** Valeur d'un champ dans un enregistrement, selon l'association choisie. */
export function mappedValue(
  headers: readonly string[],
  record: CsvRecord,
  mapping: ColumnMapping,
  field: ImportField,
): string {
  const column = mapping[field];
  if (!column) return "";
  const index = headers.indexOf(column);
  return index < 0 ? "" : (record.cells[index] ?? "");
}

const DAY_FIRST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `31/12/2026`, `31-12-26`, `2026-12-31` donnent `2026-12-31`. Date impossible : `null`. */
export function parseCsvDate(input: string): string | null {
  const value = input.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = ISO_DAY.exec(value);
  const dayFirst = DAY_FIRST.exec(value);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dayFirst) {
    day = Number(dayFirst[1]);
    month = Number(dayFirst[2]);
    const rawYear = dayFirst[3] ?? "";
    year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

/** `1 234,50 €` ou `1234.5` donnent des centimes. `1,234.50` est ambigu : `null`. */
export function parseCsvAmount(input: string): number | null {
  return parseEurosToCents(input.trim());
}

const STATUS_SYNONYMS: Record<string, FinancialDocumentStatus> = {
  paye: "paid",
  payee: "paid",
  payees: "paid",
  regle: "paid",
  reglee: "paid",
  encaisse: "paid",
  encaissee: "paid",
  acquittee: "paid",
  paid: "paid",
  envoye: "issued",
  envoyee: "issued",
  emise: "issued",
  emis: "issued",
  finalisee: "issued",
  "en attente": "issued",
  "en attente de paiement": "issued",
  "a payer": "issued",
  "a regler": "issued",
  impayee: "issued",
  "non payee": "issued",
  issued: "issued",
  sent: "issued",
  "en retard": "overdue",
  retard: "overdue",
  echue: "overdue",
  overdue: "overdue",
  annule: "cancelled",
  annulee: "cancelled",
  cancelled: "cancelled",
};

/** Libellé d'état d'un fichier. Inconnu : `null`, jamais une supposition. */
export function parseCsvStatus(input: string): FinancialDocumentStatus | null {
  const key = normalize(input);
  return Object.hasOwn(STATUS_SYNONYMS, key) ? (STATUS_SYNONYMS[key] ?? null) : null;
}

const KIND_SYNONYMS: Record<string, FinancialDocumentKind> = {
  facture: "invoice",
  invoice: "invoice",
  avoir: "credit_note",
  "facture d avoir": "credit_note",
  credit: "credit_note",
  "credit note": "credit_note",
};

export function parseCsvKind(input: string): FinancialDocumentKind | null {
  const key = normalize(input);
  return Object.hasOwn(KIND_SYNONYMS, key) ? (KIND_SYNONYMS[key] ?? null) : null;
}

/** SIREN à partir d'un SIREN ou d'un SIRET, espaces tolérés. `null` si ce n'est ni l'un ni l'autre. */
export function parseCsvSiren(input: string): string | null {
  const digits = input.replace(/\s/g, "");
  return /^\d{9}(\d{5})?$/.test(digits) ? digits.slice(0, 9) : null;
}

/** Forme de comparaison d'un nom de client ou d'associé. */
export function matchKey(input: string): string {
  return normalize(input);
}
