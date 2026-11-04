import {
  decodeCsvBytes,
  mappedValue,
  matchKey,
  parseCsv,
  parseCsvAmount,
  parseCsvDate,
  parseCsvKind,
  parseCsvSiren,
  parseCsvStatus,
  suggestMapping,
  type ColumnMapping,
  type CsvRecord,
  type ImportField,
} from "@/integrations/indy/indy.csv";
import {
  FINANCIAL_DOCUMENT_STATUS_LABELS,
  type FinancialDocumentKind,
  type FinancialDocumentStatus,
} from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { FinanceImport, FinancialDocument } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { NotFoundError, ValidationError } from "@/server/errors";
import type { PageParams, Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { IMPORT_TOO_LARGE, MAX_IMPORT_BYTES } from "./finance.constants";
import { parisDay } from "./finance.dates";
import * as repository from "./finance.repository";
import { columnMappingSchema } from "./finance.schema";
import { alignOverdue, applyInvoiceStatus, isUuid, syncScheduleItem } from "./finance.service";
import { canInvoiceTransition } from "./invoice.status";

export const MAX_IMPORT_ROWS = 5_000;
const MAX_STORED_REJECTIONS = 500;
const PREVIEW_ROWS = 30;

export interface ImportFile {
  filename: string | null;
  bytes: Uint8Array;
}

export type ImportAction = "create" | "update" | "unchanged" | "reject";

export interface ImportRowOutcome {
  line: number;
  externalRef: string | null;
  companyName: string | null;
  amountCents: number | null;
  status: FinancialDocumentStatus | null;
  action: ImportAction;
  errors: string[];
}

export interface ImportRejection {
  line: number;
  externalRef: string | null;
  message: string;
}

export interface ImportPreview {
  filename: string | null;
  headers: string[];
  mapping: ColumnMapping;
  /** Champs obligatoires sans colonne associée : l'import ne peut pas partir. */
  missingFields: string[];
  total: number;
  creates: number;
  updates: number;
  unchanged: number;
  rejected: number;
  /** Lignes montrées : tous les refus d'abord, dans la limite d'un aperçu. */
  rows: ImportRowOutcome[];
}

interface PlannedRow extends ImportRowOutcome {
  values?: PlannedValues;
  existing?: FinancialDocument;
}

interface PlannedValues {
  companyId: string;
  projectId: string | null;
  contractId: string | null;
  kind: FinancialDocumentKind;
  externalRef: string;
  issuerMemberId: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  amountCents: number;
  taxCents: number;
  targetStatus: FinancialDocumentStatus | null;
  paidOn: string | null;
}

/** Index d'une table : plusieurs objets sous la même clé rendent la clé ambiguë. */
function indexBy<T>(rows: readonly T[], keys: (row: T) => (string | null | undefined)[]) {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    for (const key of keys(row)) {
      if (!key) continue;
      const normalized = matchKey(key);
      if (!normalized) continue;
      index.set(normalized, [...(index.get(normalized) ?? []), row]);
    }
  }
  return index;
}

function readFile(file: ImportFile) {
  if (file.bytes.length === 0) {
    throw new ValidationError("Ce fichier est vide.", { file: ["Ce fichier est vide."] });
  }
  if (file.bytes.length > MAX_IMPORT_BYTES) {
    throw new ValidationError(IMPORT_TOO_LARGE, { file: [IMPORT_TOO_LARGE] });
  }
  const parsed = parseCsv(decodeCsvBytes(file.bytes));
  if (parsed.headers.length === 0) {
    throw new ValidationError("Aucune colonne trouvée dans ce fichier.", {
      file: ["Aucune colonne trouvée dans ce fichier."],
    });
  }
  if (parsed.records.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(`Ce fichier dépasse ${MAX_IMPORT_ROWS} lignes : découpez-le.`, {
      file: [`Ce fichier dépasse ${MAX_IMPORT_ROWS} lignes : découpez-le.`],
    });
  }
  return parsed;
}

function missingFields(mapping: ColumnMapping): string[] {
  const missing: string[] = [];
  if (!mapping.externalRef) missing.push("Référence de la facture");
  if (!mapping.company && !mapping.siren) missing.push("Client ou SIREN");
  if (!mapping.amountHt && !(mapping.amountTtc && mapping.tax)) {
    missing.push("Montant HT (ou TTC et TVA)");
  }
  if (!mapping.issuedOn) missing.push("Date d'émission");
  return missing;
}

/** Évalue chaque ligne sans rien écrire : l'aperçu et l'import réel partagent ce seul jugement. */
async function planRows(
  db: Database,
  headers: readonly string[],
  records: readonly CsvRecord[],
  mapping: ColumnMapping,
  today: string,
): Promise<PlannedRow[]> {
  const lookups = await repository.loadImportLookups(db);
  const companiesBySiren = indexBy(lookups.companyRows, (row) => [row.siren]);
  const companiesByName = indexBy(lookups.companyRows, (row) => [row.name]);
  const projectsByKey = indexBy(lookups.projectRows, (row) => [row.number, row.name]);
  const contractsByKey = indexBy(lookups.contractRows, (row) => [row.number, row.name]);
  // Les associés seuls émettent (A12). Un associé parti reste reconnu : ses factures restent vraies.
  const partners = lookups.memberRows.filter((row) => row.kind === "partner");
  const membersByKey = indexBy(partners, (row) => [
    row.fullName,
    row.email,
    row.fullName.split(/\s+/)[0],
  ]);

  const value = (record: CsvRecord, field: ImportField) =>
    mappedValue(headers, record, mapping, field);

  const refs = records.map((record) => value(record, "externalRef")).filter(Boolean);
  const existingByRef = new Map(
    (await repository.findDocumentsByRefs(db, refs)).flatMap((row) =>
      row.externalRef ? [[row.externalRef, row] as const] : [],
    ),
  );

  const seen = new Set<string>();
  return records.map((record) => {
    const errors: string[] = [];
    const externalRef = value(record, "externalRef") || null;
    if (!externalRef) errors.push("Référence manquante.");
    else if (seen.has(externalRef)) errors.push("Référence en double dans ce fichier.");
    if (externalRef) seen.add(externalRef);

    // Client : le SIREN fait foi quand il est là, sinon le nom exact.
    const companyName = value(record, "company");
    const sirenRaw = value(record, "siren");
    let company: (typeof lookups.companyRows)[number] | undefined;
    if (sirenRaw) {
      const siren = parseCsvSiren(sirenRaw);
      if (!siren) errors.push(`SIREN illisible : « ${sirenRaw} ».`);
      else company = companiesBySiren.get(matchKey(siren))?.[0];
    }
    if (!company && companyName) {
      const matches = companiesByName.get(matchKey(companyName)) ?? [];
      if (matches.length > 1) {
        errors.push(`Plusieurs clients s'appellent « ${companyName} » : ajoutez le SIREN.`);
      } else {
        company = matches[0];
      }
    }
    if (!company && errors.every((error) => !error.includes("Plusieurs clients"))) {
      errors.push(
        companyName || sirenRaw
          ? `Client introuvable : « ${companyName || sirenRaw} ».`
          : "Client manquant.",
      );
    }

    // Montants : aucun HT n'est deviné. Sans HT, il se déduit du TTC et de la TVA, tous deux lus.
    const ht = value(record, "amountHt");
    const ttc = value(record, "amountTtc");
    const tax = value(record, "tax");
    const htCents = ht ? parseCsvAmount(ht) : null;
    const ttcCents = ttc ? parseCsvAmount(ttc) : null;
    const taxRead = tax ? parseCsvAmount(tax) : null;
    if (ht && htCents === null) errors.push(`Montant HT illisible : « ${ht} ».`);
    if (ttc && ttcCents === null) errors.push(`Montant TTC illisible : « ${ttc} ».`);
    if (tax && taxRead === null) errors.push(`TVA illisible : « ${tax} ».`);
    const amount = htCents ?? (ttcCents !== null && taxRead !== null ? ttcCents - taxRead : null);
    if (amount === null && !ht && !ttc) errors.push("Montant HT manquant.");
    else if (amount === 0) errors.push("Montant nul.");
    const taxCents = taxRead ?? (htCents !== null && ttcCents !== null ? ttcCents - htCents : 0);

    // Un avoir est négatif en base, quel que soit le signe du fichier.
    const kindRaw = value(record, "kind");
    let kind: FinancialDocumentKind = amount !== null && amount < 0 ? "credit_note" : "invoice";
    if (kindRaw) {
      const parsedKind = parseCsvKind(kindRaw);
      if (parsedKind) kind = parsedKind;
      else errors.push(`Type de document inconnu : « ${kindRaw} ».`);
    }
    if (kind === "invoice" && amount !== null && amount < 0) {
      errors.push("Une facture ne peut pas être négative : indiquez le type « Avoir ».");
    }
    const sign = kind === "credit_note" ? -1 : 1;
    const amountCents = amount === null ? null : sign * Math.abs(amount);

    const readDate = (field: ImportField, label: string) => {
      const raw = value(record, field);
      if (!raw) return null;
      const parsed = parseCsvDate(raw);
      if (!parsed) errors.push(`${label} illisible : « ${raw} ».`);
      return parsed;
    };
    const issuedOn = readDate("issuedOn", "Date d'émission");
    const dueOn = readDate("dueOn", "Date d'échéance");
    const paidOn = readDate("paidOn", "Date de paiement");
    if (!value(record, "issuedOn")) errors.push("Date d'émission manquante.");
    if (issuedOn && dueOn && dueOn < issuedOn) {
      errors.push("L'échéance précède l'émission.");
    }
    if (paidOn && paidOn > today) errors.push("La date de paiement est future.");

    const statusRaw = value(record, "status");
    let status: FinancialDocumentStatus | null = null;
    if (statusRaw) {
      status = parseCsvStatus(statusRaw);
      if (!status) errors.push(`État inconnu : « ${statusRaw} ».`);
    } else if (paidOn) {
      status = "paid";
    }

    const belongsTo = <T extends { companyId: string }>(
      field: ImportField,
      label: string,
      index: Map<string, T[]>,
    ): T | null => {
      const raw = value(record, field);
      if (!raw) return null;
      const matches = (index.get(matchKey(raw)) ?? []).filter(
        (row) => !company || row.companyId === company.id,
      );
      if (matches.length !== 1) {
        errors.push(
          matches.length > 1
            ? `${label} ambigu pour ce client : « ${raw} ».`
            : `${label} introuvable pour ce client : « ${raw} ».`,
        );
        return null;
      }
      return matches[0] ?? null;
    };
    const project = belongsTo("project", "Projet", projectsByKey) as { id: string } | null;
    const contract = belongsTo("contract", "Contrat", contractsByKey) as { id: string } | null;

    const issuerRaw = value(record, "issuer");
    let issuerMemberId: string | null = null;
    if (issuerRaw) {
      const matches = membersByKey.get(matchKey(issuerRaw)) ?? [];
      if (matches.length !== 1) {
        errors.push(
          matches.length > 1
            ? `Émetteur ambigu : « ${issuerRaw} ».`
            : `Émetteur introuvable : « ${issuerRaw} ».`,
        );
      } else {
        issuerMemberId = matches[0]?.id ?? null;
      }
    }

    const existing = externalRef ? existingByRef.get(externalRef) : undefined;
    if (existing && company && existing.companyId !== company.id) {
      errors.push("Cette référence appartient déjà à un autre client.");
    }

    // État visé : une facture « envoyée » dont l'échéance est passée reste en retard.
    const effectiveDue = dueOn ?? existing?.dueOn ?? null;
    let targetStatus = status;
    if (targetStatus === "issued" && kind === "invoice" && effectiveDue && effectiveDue < today) {
      targetStatus = "overdue";
    }
    const effectivePaidOn = paidOn ?? existing?.paidOn ?? null;
    if (targetStatus === "paid" && !effectivePaidOn) {
      errors.push("Payée sans date de paiement : associez cette colonne.");
    }
    // Un paiement retiré dans Indy, échéance passée : la facture repasse par « envoyée », puis en retard.
    const unpaidAndLate = existing?.status === "paid" && targetStatus === "overdue";
    if (
      existing &&
      targetStatus &&
      targetStatus !== existing.status &&
      !unpaidAndLate &&
      !canInvoiceTransition(existing.status, targetStatus)
    ) {
      errors.push(
        `Passage de « ${FINANCIAL_DOCUMENT_STATUS_LABELS[existing.status]} » à « ${FINANCIAL_DOCUMENT_STATUS_LABELS[targetStatus]} » impossible.`,
      );
    }

    const base = {
      line: record.line,
      externalRef,
      companyName: company?.name ?? (companyName || null),
      amountCents,
      status: targetStatus ?? existing?.status ?? "issued",
    };
    if (errors.length > 0 || !company || !externalRef || amountCents === null) {
      return { ...base, action: "reject" as const, errors };
    }

    const values: PlannedValues = {
      companyId: company.id,
      projectId: project?.id ?? existing?.projectId ?? null,
      contractId: contract?.id ?? existing?.contractId ?? null,
      kind,
      externalRef,
      issuerMemberId: issuerMemberId ?? existing?.issuerMemberId ?? null,
      issuedOn: issuedOn ?? existing?.issuedOn ?? null,
      dueOn: effectiveDue,
      amountCents,
      taxCents: sign * Math.abs(taxCents),
      targetStatus,
      paidOn: effectivePaidOn,
    };

    if (!existing) return { ...base, action: "create" as const, errors, values };

    const changed =
      existing.projectId !== values.projectId ||
      existing.contractId !== values.contractId ||
      existing.kind !== values.kind ||
      existing.issuerMemberId !== values.issuerMemberId ||
      existing.issuedOn !== values.issuedOn ||
      existing.dueOn !== values.dueOn ||
      existing.amountCents !== values.amountCents ||
      existing.taxCents !== values.taxCents ||
      (targetStatus !== null && targetStatus !== existing.status) ||
      (targetStatus === "paid" && existing.paidOn !== values.paidOn);
    if (changed && existing.status === "cancelled") {
      return {
        ...base,
        action: "reject" as const,
        errors: ["Une facture annulée ne se modifie plus."],
      };
    }
    return {
      ...base,
      action: changed ? ("update" as const) : ("unchanged" as const),
      errors,
      values,
      existing,
    };
  });
}

function toOutcome(row: PlannedRow): ImportRowOutcome {
  return {
    line: row.line,
    externalRef: row.externalRef,
    companyName: row.companyName,
    amountCents: row.amountCents,
    status: row.status,
    action: row.action,
    errors: row.errors,
  };
}

function resolveMapping(headers: readonly string[], rawMapping: unknown): ColumnMapping {
  if (rawMapping === undefined || rawMapping === null) return suggestMapping(headers);
  const parsed = parseInput(columnMappingSchema, rawMapping);
  const mapping: ColumnMapping = {};
  for (const [field, column] of Object.entries(parsed)) {
    if (!column) continue;
    if (!headers.includes(column)) {
      throw new ValidationError(`La colonne « ${column} » n'existe pas dans ce fichier.`);
    }
    mapping[field as ImportField] = column;
  }
  return mapping;
}

/** Aperçu : ce que ferait l'import, sans rien écrire. `mapping` absent : association suggérée. */
export async function previewInvoiceImport(
  ctx: ServiceContext,
  file: ImportFile,
  rawMapping?: unknown,
  now: Date = new Date(),
): Promise<ImportPreview> {
  assertCan(ctx.actor, "finance:manage");
  const parsed = readFile(file);
  const mapping = resolveMapping(parsed.headers, rawMapping);
  const missing = missingFields(mapping);
  const rows =
    missing.length > 0
      ? []
      : await planRows(ctx.db, parsed.headers, parsed.records, mapping, parisDay(now));
  const rejected = rows.filter((row) => row.action === "reject");
  const others = rows.filter((row) => row.action !== "reject");
  return {
    filename: file.filename,
    headers: parsed.headers,
    mapping,
    missingFields: missing,
    total: parsed.records.length,
    creates: rows.filter((row) => row.action === "create").length,
    updates: rows.filter((row) => row.action === "update").length,
    unchanged: rows.filter((row) => row.action === "unchanged").length,
    rejected: rejected.length,
    rows: [...rejected, ...others].slice(0, PREVIEW_ROWS).map(toOutcome),
  };
}

export interface ImportResult {
  importId: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  rejections: ImportRejection[];
}

/**
 * Import réel, tout entier dans une transaction : idempotent par référence (`source`, `external_ref`).
 * Le même fichier rejoué ne crée rien, ne change rien et n'émet aucun événement. Une référence déjà
 * saisie à la main se rapproche de sa ligne, jamais en double : le revenu ne compte pas deux fois.
 */
export async function runInvoiceImport(
  ctx: ServiceContext,
  file: ImportFile,
  rawMapping: unknown,
  now: Date = new Date(),
): Promise<ImportResult> {
  assertCan(ctx.actor, "finance:manage");
  const parsed = readFile(file);
  const mapping = resolveMapping(parsed.headers, rawMapping);
  const missing = missingFields(mapping);
  if (missing.length > 0) {
    throw new ValidationError(`Colonnes à associer : ${missing.join(", ")}.`);
  }

  return ctx.db.transaction(async (tx) => {
    const rows = await planRows(tx, parsed.headers, parsed.records, mapping, parisDay(now));
    const options = { actorId: ctx.actor.userId, at: now };
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      if (!row.values) continue;
      const { targetStatus, ...values } = row.values;
      if (row.action === "create") {
        const inserted = await repository.insertDocument(tx, {
          ...values,
          source: "indy_csv",
          status: "issued",
          paidOn: null,
          importedAt: now,
        });
        await recordAudit(tx, {
          actorId: ctx.actor.userId,
          action: "financial_document.created",
          entityType: "financial_document",
          entityId: inserted.id,
          metadata: { externalRef: values.externalRef, source: "indy_csv" },
        });
        if (targetStatus && targetStatus !== "issued") {
          await applyInvoiceStatus(tx, inserted, targetStatus, {
            ...options,
            paidOn: values.paidOn,
          });
        } else {
          await alignOverdue(tx, inserted, options);
        }
        created += 1;
      } else if (row.action === "update" && row.existing) {
        const next = await repository.updateDocument(tx, row.existing.id, {
          projectId: values.projectId,
          contractId: values.contractId,
          kind: values.kind,
          issuerMemberId: values.issuerMemberId,
          issuedOn: values.issuedOn,
          dueOn: values.dueOn,
          amountCents: values.amountCents,
          taxCents: values.taxCents,
          importedAt: now,
        });
        if (!next) continue;
        await recordAudit(tx, {
          actorId: ctx.actor.userId,
          action: "financial_document.updated",
          entityType: "financial_document",
          entityId: next.id,
          metadata: {
            externalRef: values.externalRef,
            source: "indy_csv",
            fromCents: row.existing.amountCents,
            toCents: values.amountCents,
            fromPaidOn: row.existing.paidOn,
            toPaidOn: values.paidOn,
          },
        });
        if (targetStatus && targetStatus !== next.status) {
          const from =
            next.status === "paid" && targetStatus === "overdue"
              ? await applyInvoiceStatus(tx, next, "issued", options)
              : next;
          await applyInvoiceStatus(tx, from, targetStatus, { ...options, paidOn: values.paidOn });
        } else {
          if (targetStatus === "paid" && next.paidOn !== values.paidOn) {
            await repository.updateDocument(tx, next.id, { paidOn: values.paidOn });
          }
          await alignOverdue(tx, next, options);
        }
        await syncScheduleItem(tx, next.scheduleItemId);
        updated += 1;
      }
    }

    const rejections: ImportRejection[] = rows
      .filter((row) => row.action === "reject")
      .flatMap((row) =>
        row.errors.map((message) => ({
          line: row.line,
          externalRef: row.externalRef,
          message,
        })),
      );
    const rejected = rows.filter((row) => row.action === "reject").length;
    const unchanged = rows.filter((row) => row.action === "unchanged").length;

    const record = await repository.insertImport(tx, {
      source: "indy_csv",
      filename: file.filename,
      rowsTotal: rows.length,
      rowsCreated: created,
      rowsUpdated: updated,
      rowsRejected: rejected,
      errors: rejections.slice(0, MAX_STORED_REJECTIONS),
      actorId: ctx.actor.userId,
      at: now,
    });
    await repository.recordIndyImportOnConnection(tx, {
      at: now,
      details: { lastImportId: record.id, lastFilename: file.filename, rowsTotal: rows.length },
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "finance.import_ran",
      entityType: "finance_import",
      entityId: record.id,
      metadata: {
        filename: file.filename,
        total: rows.length,
        created,
        updated,
        unchanged,
        rejected,
      },
    });

    return {
      importId: record.id,
      total: rows.length,
      created,
      updated,
      unchanged,
      rejected,
      rejections,
    };
  });
}

export interface ImportHistoryRow {
  id: string;
  source: FinanceImport["source"];
  filename: string | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsRejected: number;
  at: Date;
}

export async function listImportHistory(
  ctx: ServiceContext,
  params: PageParams,
): Promise<Paginated<ImportHistoryRow>> {
  assertCan(ctx.actor, "finance:read");
  return repository.listImports(ctx.db, params);
}

function readRejections(errors: unknown[]): ImportRejection[] {
  return errors.flatMap((entry) => {
    const row = entry as Partial<ImportRejection> | null;
    if (typeof row?.line !== "number" || typeof row.message !== "string") return [];
    return [{ line: row.line, externalRef: row.externalRef ?? null, message: row.message }];
  });
}

export async function getImportReport(
  ctx: ServiceContext,
  id: string,
): Promise<ImportHistoryRow & { rejections: ImportRejection[] }> {
  assertCan(ctx.actor, "finance:read");
  const row = isUuid(id) ? await repository.getImport(ctx.db, id) : null;
  if (!row) throw new NotFoundError("Import introuvable.");
  return { ...row, rejections: readRejections(row.errors) };
}
