import { normalizeDomain } from "@/integrations/twenty/twenty.mappers";
import { COMPANY_STATUSES, type CompanyStatus } from "@/lib/domain-enums";
import { toE164Phone } from "./crm.shared";

/**
 * Lecture d'un fichier CSV de clients : fonctions pures, sans base ni réseau.
 * Séparateur `;`, `,` ou tabulation (Excel français : `;`), guillemets, marque BOM.
 */
export const MAX_IMPORT_ROWS = 500;

export interface CsvTable {
  headers: string[];
  /** `line` : numéro de ligne dans le fichier, en-tête comprise, pour le rapport. */
  rows: { line: number; cells: string[] }[];
}

function detectSeparator(firstLine: string): string {
  const counts = [";", ",", "\t"].map((separator) => ({
    separator,
    count: firstLine.split(separator).length - 1,
  }));
  return counts.sort((a, b) => b.count - a.count)[0]?.separator ?? ";";
}

export function parseCsv(text: string): CsvTable {
  const source = text.replace(/^﻿/, "");
  const newline = source.search(/\r?\n/);
  const separator = detectSeparator(newline === -1 ? source : source.slice(0, newline));

  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    if (cells.some((value) => value.trim() !== "")) records.push({ line: recordLine, cells });
    cells = [];
    cell = "";
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
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === separator) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n") {
      endRecord();
      line += 1;
      recordLine = line;
    } else if (char !== "\r") {
      cell += char;
    }
  }
  endRecord();

  const [header, ...rows] = records;
  return { headers: header?.cells.map((value) => value.trim()) ?? [], rows };
}

export type ImportField =
  | "name"
  | "domain"
  | "activity"
  | "status"
  | "source"
  | "siren"
  | "phone"
  | "addressLine"
  | "postalCode"
  | "city"
  | "country"
  | "tags"
  | "notes"
  | "contactFirstName"
  | "contactLastName"
  | "contactEmail"
  | "contactPhone"
  | "contactJobTitle";

/** En-têtes reconnues, comparées sans accent ni casse. */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  name: ["nom", "societe", "entreprise", "client", "raison sociale", "name", "company"],
  domain: ["domaine", "site", "site web", "domain", "website"],
  activity: ["activite", "metier", "secteur", "activity"],
  status: ["statut", "status"],
  source: ["origine", "source", "canal"],
  siren: ["siren"],
  phone: ["telephone", "tel", "telephone societe", "phone"],
  addressLine: ["adresse", "address"],
  postalCode: ["code postal", "cp", "postal code", "postcode"],
  city: ["ville", "city"],
  country: ["pays", "country"],
  tags: ["tags", "etiquettes"],
  notes: ["notes", "commentaire", "commentaires"],
  contactFirstName: ["prenom", "contact prenom", "prenom contact", "first name"],
  contactLastName: ["nom contact", "contact nom", "contact", "last name"],
  contactEmail: ["e-mail", "email", "mail", "courriel", "contact email", "e-mail contact"],
  contactPhone: ["telephone contact", "contact telephone", "mobile", "portable"],
  contactJobTitle: ["poste", "fonction", "job title"],
};

function headerKey(header: string): string {
  return header
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .trim();
}

export interface ColumnMapping {
  columns: Partial<Record<ImportField, number>>;
  /** En-têtes du fichier qui ne correspondent à rien : affichées pour que rien ne se perde en silence. */
  ignored: string[];
}

export function mapColumns(headers: readonly string[]): ColumnMapping {
  const columns: Partial<Record<ImportField, number>> = {};
  const ignored: string[] = [];
  headers.forEach((header, index) => {
    const key = headerKey(header);
    const field = (Object.keys(HEADER_ALIASES) as ImportField[]).find(
      (candidate) => HEADER_ALIASES[candidate].includes(key) && columns[candidate] === undefined,
    );
    if (field) columns[field] = index;
    else if (header) ignored.push(header);
  });
  return { columns, ignored };
}

const STATUS_ALIASES: Record<string, CompanyStatus> = {
  prospect: "prospect",
  client: "client",
  abonne: "subscriber",
  subscriber: "subscriber",
  ancien: "former",
  "ancien client": "former",
  former: "former",
  partenaire: "partner",
  partner: "partner",
};

export interface ImportRow {
  line: number;
  name: string;
  domain: string | null;
  activity: string | null;
  status: CompanyStatus;
  source: string | null;
  siren: string | null;
  phone: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  tags: string[];
  notes: string | null;
  contact: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    jobTitle: string | null;
  } | null;
}

export interface ParsedImportRow {
  row: ImportRow | null;
  line: number;
  /** Ce qu'on peut afficher d'une ligne refusée. */
  label: string;
  errors: string[];
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valide une ligne. Tout champ invalide refuse la ligne : mieux vaut un rapport qu'une fiche fausse. */
export function parseImportRow(
  mapping: ColumnMapping,
  source: { line: number; cells: string[] },
): ParsedImportRow {
  const read = (field: ImportField): string | null => {
    const index = mapping.columns[field];
    const value = index === undefined ? "" : (source.cells[index] ?? "").trim();
    return value === "" ? null : value;
  };
  const errors: string[] = [];

  const name = read("name");
  if (!name) errors.push("Nom du client manquant.");

  const rawDomain = read("domain");
  const domain = rawDomain ? normalizeDomain(rawDomain) : null;
  if (domain && !DOMAIN.test(domain)) errors.push(`Domaine invalide : ${rawDomain}.`);

  const rawStatus = read("status");
  const status = rawStatus ? STATUS_ALIASES[headerKey(rawStatus)] : "prospect";
  if (!status) {
    errors.push(`Statut inconnu : ${rawStatus}. Attendu : ${COMPANY_STATUSES.join(", ")}.`);
  }

  const rawSiren = read("siren")?.replace(/\s/g, "") ?? null;
  if (rawSiren && !/^\d{9}$/.test(rawSiren)) errors.push(`SIREN invalide : ${rawSiren}.`);

  const rawPhone = read("phone");
  const phone = rawPhone ? toE164Phone(rawPhone) : null;
  if (rawPhone && !phone) errors.push(`Téléphone invalide : ${rawPhone}.`);

  const email = read("contactEmail")?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) errors.push(`E-mail invalide : ${email}.`);

  const rawContactPhone = read("contactPhone");
  const contactPhone = rawContactPhone ? toE164Phone(rawContactPhone) : null;
  if (rawContactPhone && !contactPhone) {
    errors.push(`Téléphone du contact invalide : ${rawContactPhone}.`);
  }

  const firstName = read("contactFirstName") ?? "";
  const lastName = read("contactLastName") ?? "";
  const hasContact = firstName !== "" || lastName !== "" || email !== null;

  if (errors.length > 0 || !name || !status) {
    return { row: null, line: source.line, label: name ?? source.cells.join(" ").trim(), errors };
  }

  return {
    line: source.line,
    label: name,
    errors,
    row: {
      line: source.line,
      name,
      domain,
      activity: read("activity"),
      status,
      source: read("source"),
      siren: rawSiren,
      phone,
      addressLine: read("addressLine"),
      postalCode: read("postalCode"),
      city: read("city"),
      country: read("country"),
      tags: (read("tags") ?? "")
        .split(/[,|]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      notes: read("notes"),
      contact: hasContact
        ? {
            firstName,
            // Twenty accepte un contact sans nom ; une adresse seule sert alors de libellé.
            lastName: lastName || (firstName === "" && email ? email : ""),
            email,
            phone: contactPhone,
            jobTitle: read("contactJobTitle"),
          }
        : null,
    },
  };
}
