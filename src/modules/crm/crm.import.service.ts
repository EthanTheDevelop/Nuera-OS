import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { isAppError, ServiceUnavailableError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { randomUUID } from "node:crypto";
import { createCompany } from "./company.service";
import { findCompaniesMatching, findCompanyById } from "./company.repository";
import { createContact } from "./contact.service";
import { findContactById, findContactsByEmail } from "./contact.repository";
import {
  MAX_IMPORT_ROWS,
  mapColumns,
  parseCsv,
  parseImportRow,
  type ImportRow,
  type ParsedImportRow,
} from "./crm.import";
import { importBatchSchema, importPreviewSchema } from "./crm.schema";
import { deriveUuid, DuplicateRecordError, normalizeName } from "./crm.shared";

/**
 * Import CSV en deux temps, sans état sur le serveur : l'aperçu ne crée rien, puis l'écran envoie des
 * lots courts, relus et revalidés ici. Chaque ligne a des identifiants dérivés de l'import : une
 * reprise après coupure retrouve ce qui existe déjà, sans doublon.
 */
export type ImportRowStatus = "ready" | "duplicate" | "rejected";

export interface ImportPreviewRow {
  line: number;
  name: string;
  domain: string | null;
  contact: string | null;
  email: string | null;
  status: ImportRowStatus;
  reasons: string[];
  duplicateOf: { id: string; name: string } | null;
}

export interface ImportPreview {
  importId: string;
  rows: ImportPreviewRow[];
  ready: number;
  duplicates: number;
  rejected: number;
  ignoredColumns: string[];
}

function parseFile(csv: string): { parsed: ParsedImportRow[]; ignoredColumns: string[] } {
  const table = parseCsv(csv);
  const mapping = mapColumns(table.headers);
  if (mapping.columns.name === undefined) {
    throw new ValidationError(
      "Colonne du nom introuvable : le fichier doit avoir une colonne « Nom » ou « Société ».",
    );
  }
  if (table.rows.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `Fichier trop long : ${table.rows.length} lignes pour ${MAX_IMPORT_ROWS} au maximum. Découpez-le.`,
    );
  }
  return {
    parsed: table.rows.map((row) => parseImportRow(mapping, row)),
    ignoredColumns: mapping.ignored,
  };
}

async function findDuplicate(
  ctx: ServiceContext,
  row: ImportRow,
): Promise<{ reasons: string[]; duplicateOf: { id: string; name: string } | null }> {
  const matches = await findCompaniesMatching(ctx.db, {
    domain: row.domain,
    siren: row.siren,
    normalizedName: normalizeName(row.name),
  });
  const match =
    matches.find((company) => row.domain && company.domain?.toLowerCase() === row.domain) ??
    matches.find((company) => row.siren && company.siren === row.siren) ??
    matches.find(
      (company) => !company.archivedAt && normalizeName(company.name) === normalizeName(row.name),
    );
  if (match) {
    const by =
      row.domain && match.domain?.toLowerCase() === row.domain
        ? "même domaine"
        : row.siren && match.siren === row.siren
          ? "même SIREN"
          : "même nom";
    const archived = match.archivedAt ? ", fiche archivée" : "";
    return {
      reasons: [`Doublon de « ${match.name} » (${by}${archived}).`],
      duplicateOf: { id: match.id, name: match.name },
    };
  }
  if (row.contact?.email) {
    const [contact] = await findContactsByEmail(ctx.db, row.contact.email);
    if (contact) {
      return {
        reasons: [`L'adresse ${row.contact.email} appartient déjà à un contact.`],
        duplicateOf: null,
      };
    }
  }
  return { reasons: [], duplicateOf: null };
}

/** Lit le fichier et classe chaque ligne : prête, doublon ou refusée. N'écrit rien. */
export async function previewCompanyImport(
  ctx: ServiceContext,
  input: unknown,
): Promise<ImportPreview> {
  assertCan(ctx.actor, "crm:create");
  const { csv } = parseInput(importPreviewSchema, input);
  const { parsed, ignoredColumns } = parseFile(csv);

  const seen = {
    domains: new Map<string, number>(),
    emails: new Map<string, number>(),
    names: new Map<string, number>(),
  };
  const rows: ImportPreviewRow[] = [];

  for (const entry of parsed) {
    const { row } = entry;
    const base = {
      line: entry.line,
      name: entry.label,
      domain: row?.domain ?? null,
      contact: row?.contact
        ? [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" ") || null
        : null,
      email: row?.contact?.email ?? null,
    };
    if (!row) {
      rows.push({ ...base, status: "rejected", reasons: entry.errors, duplicateOf: null });
      continue;
    }
    const nameKey = normalizeName(row.name);
    const inFile =
      (row.domain ? seen.domains.get(row.domain) : undefined) ??
      (row.contact?.email ? seen.emails.get(row.contact.email) : undefined) ??
      seen.names.get(nameKey);
    if (inFile !== undefined) {
      rows.push({
        ...base,
        status: "duplicate",
        reasons: [`Doublon de la ligne ${inFile} de ce fichier.`],
        duplicateOf: null,
      });
      continue;
    }
    if (row.domain) seen.domains.set(row.domain, row.line);
    if (row.contact?.email) seen.emails.set(row.contact.email, row.line);
    seen.names.set(nameKey, row.line);

    const { reasons, duplicateOf } = await findDuplicate(ctx, row);
    rows.push({
      ...base,
      status: reasons.length > 0 ? "duplicate" : "ready",
      reasons,
      duplicateOf,
    });
  }

  return {
    importId: randomUUID(),
    rows,
    ready: rows.filter((row) => row.status === "ready").length,
    duplicates: rows.filter((row) => row.status === "duplicate").length,
    rejected: rows.filter((row) => row.status === "rejected").length,
    ignoredColumns,
  };
}

export interface ImportLineResult {
  line: number;
  status: "created" | "already" | "duplicate" | "failed";
  message: string | null;
  companyId: string | null;
}

export interface ImportBatchResult {
  results: ImportLineResult[];
  /** Le CRM ne répond plus : les lignes restantes n'ont pas été tentées, l'import peut reprendre. */
  stoppedBy: string | null;
}

const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

async function importLine(
  ctx: ServiceContext,
  importId: string,
  row: ImportRow,
): Promise<ImportLineResult> {
  const companyId = deriveUuid("crm-import", importId, String(row.line), "company");
  const contactId = deriveUuid("crm-import", importId, String(row.line), "contact");
  const already = await findCompanyById(ctx.db, companyId);
  const contactDone = row.contact ? await findContactById(ctx.db, contactId) : true;
  if (already && contactDone) {
    return { line: row.line, status: "already", message: null, companyId };
  }

  try {
    await createCompany(ctx, {
      id: companyId,
      name: row.name,
      domain: orUndefined(row.domain),
      activity: orUndefined(row.activity),
      status: row.status,
      source: orUndefined(row.source),
      siren: orUndefined(row.siren),
      phone: orUndefined(row.phone),
      addressLine: orUndefined(row.addressLine),
      postalCode: orUndefined(row.postalCode),
      city: orUndefined(row.city),
      country: orUndefined(row.country),
      tags: row.tags,
      notes: orUndefined(row.notes),
    });
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    if (error instanceof DuplicateRecordError) {
      return {
        line: row.line,
        status: "duplicate",
        message: error.message,
        companyId: error.duplicate.id,
      };
    }
    return {
      line: row.line,
      status: "failed",
      message: isAppError(error) ? error.message : "Ligne non importée.",
      companyId: null,
    };
  }

  if (row.contact) {
    try {
      await createContact(ctx, {
        id: contactId,
        companyId,
        firstName: row.contact.firstName,
        lastName: row.contact.lastName,
        email: orUndefined(row.contact.email),
        phone: orUndefined(row.contact.phone),
        jobTitle: orUndefined(row.contact.jobTitle),
        isPrimary: true,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      return {
        line: row.line,
        status: "created",
        message: `Client créé, contact refusé : ${isAppError(error) ? error.message : "erreur inattendue."}`,
        companyId,
      };
    }
  }
  return { line: row.line, status: "created", message: null, companyId };
}

/** Importe les lignes demandées, une par une. S'arrête à la première coupure du CRM. */
export async function runCompanyImportBatch(
  ctx: ServiceContext,
  input: unknown,
): Promise<ImportBatchResult> {
  assertCan(ctx.actor, "crm:create");
  const { importId, csv, lines } = parseInput(importBatchSchema, input);
  const { parsed } = parseFile(csv);
  const byLine = new Map(parsed.map((entry) => [entry.line, entry]));

  const results: ImportLineResult[] = [];
  let stoppedBy: string | null = null;
  for (const line of lines) {
    const entry = byLine.get(line);
    if (!entry?.row) {
      results.push({
        line,
        status: "failed",
        message: entry?.errors.join(" ") || "Ligne introuvable dans le fichier.",
        companyId: null,
      });
      continue;
    }
    try {
      results.push(await importLine(ctx, importId, entry.row));
    } catch (error) {
      if (!(error instanceof ServiceUnavailableError)) throw error;
      stoppedBy = error.message;
      break;
    }
  }

  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "crm.import_ran",
    entityType: "company",
    metadata: {
      importId,
      lines: results.length,
      created: results.filter((result) => result.status === "created").length,
      rejected: results.filter(
        (result) => result.status !== "created" && result.status !== "already",
      ).length,
      stopped: stoppedBy !== null,
    },
  });
  return { results, stoppedBy };
}
