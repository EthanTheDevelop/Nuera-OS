import {
  BILLING_PERIOD_LABELS,
  COST_CATEGORY_LABELS,
  COST_NATURE_LABELS,
  FINANCIAL_DOCUMENT_KIND_LABELS,
  FINANCIAL_DOCUMENT_SOURCE_LABELS,
  FINANCIAL_DOCUMENT_STATUS_LABELS,
  SCHEDULE_ITEM_STATUS_LABELS,
} from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { MAX_PAGE_SIZE, type PageParams, type Paginated } from "@/server/pagination";
import { centsToCsvEuros, toCsv } from "./finance.csv";
import { parisDay } from "./finance.dates";
import { EXPORT_DATASETS, type ExportDataset } from "./finance.constants";
import * as repository from "./finance.repository";
import { getImportReport } from "./import.service";
import { listProfitability, type ProfitabilityRow } from "./profitability.service";

export { EXPORT_DATASETS };
export type { ExportDataset };

/** Plafond d'un export : au-delà, le fichier ne s'ouvrirait plus dans un tableur courant. */
const MAX_EXPORT_ROWS = 20_000;

async function readAll<T>(load: (params: PageParams) => Promise<Paginated<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await load({ page, pageSize: MAX_PAGE_SIZE });
    rows.push(...result.items);
    if (result.items.length < MAX_PAGE_SIZE || rows.length >= MAX_EXPORT_ROWS) return rows;
  }
}

function marginRows(rows: readonly ProfitabilityRow[]) {
  return rows.map((row) => [
    row.title,
    row.subtitle,
    centsToCsvEuros(row.margin.forecast.revenueCents),
    centsToCsvEuros(row.margin.forecast.totalCostCents),
    centsToCsvEuros(row.margin.forecast.marginCents),
    row.margin.forecast.marginPercent === null ? "" : Math.round(row.margin.forecast.marginPercent),
    centsToCsvEuros(row.margin.actual.revenueCents),
    centsToCsvEuros(row.margin.actual.timeCostCents),
    centsToCsvEuros(row.margin.actual.directCostCents),
    centsToCsvEuros(row.margin.actual.totalCostCents),
    centsToCsvEuros(row.margin.actual.marginCents),
    row.margin.actual.marginPercent === null ? "" : Math.round(row.margin.actual.marginPercent),
  ]);
}

const MARGIN_HEADERS = [
  "Objet",
  "Rattachement",
  "Revenu prévu HT (€)",
  "Coût prévu (€)",
  "Marge prévue (€)",
  "Marge prévue (%)",
  "Revenu facturé HT (€)",
  "Coût du temps (€)",
  "Coûts directs (€)",
  "Coût réel (€)",
  "Marge réelle (€)",
  "Marge réelle (%)",
];

/**
 * Fichier CSV d'un jeu de données, généré côté serveur et tracé dans le journal. Réservé aux rôles
 * qui ont `finance:read` et `export:run`. Un montant absent reste une cellule vide, jamais 0.
 */
export async function exportFinanceCsv(
  ctx: ServiceContext,
  dataset: string,
  options: { importId?: string; now?: Date } = {},
): Promise<{ filename: string; csv: string; rows: number }> {
  assertCan(ctx.actor, "finance:read");
  assertCan(ctx.actor, "export:run");
  if (!EXPORT_DATASETS.includes(dataset as ExportDataset)) {
    throw new ValidationError("Cet export n'existe pas.");
  }
  const now = options.now ?? new Date();
  const today = parisDay(now);

  let headers: string[];
  let rows: (string | number | null | undefined)[][];
  switch (dataset as ExportDataset) {
    case "factures": {
      const items = await readAll((params) => repository.listInvoices(ctx.db, {}, params, today));
      headers = [
        "Référence Indy",
        "Type",
        "Client",
        "Projet",
        "Contrat",
        "Échéance liée",
        "Émise par",
        "Émise le",
        "Échéance",
        "Montant HT (€)",
        "TVA (€)",
        "État",
        "Payée le",
        "Source",
      ];
      rows = items.map((row) => [
        row.externalRef,
        FINANCIAL_DOCUMENT_KIND_LABELS[row.kind],
        row.companyName,
        row.projectName,
        row.contractName,
        row.scheduleLabel,
        row.issuerName,
        row.issuedOn,
        row.dueOn,
        centsToCsvEuros(row.amountCents),
        centsToCsvEuros(row.taxCents),
        FINANCIAL_DOCUMENT_STATUS_LABELS[row.status],
        row.paidOn,
        FINANCIAL_DOCUMENT_SOURCE_LABELS[row.source],
      ]);
      break;
    }
    case "echeancier": {
      const items = await readAll((params) => repository.listScheduleItems(ctx.db, {}, params));
      headers = [
        "Échéance",
        "Client",
        "Projet",
        "Contrat",
        "Date",
        "Montant HT (€)",
        "Facturé HT (€)",
        "Factures",
        "État",
      ];
      rows = items.map((row) => [
        row.label,
        row.companyName,
        row.projectName,
        row.contractName,
        row.dueOn,
        centsToCsvEuros(row.amountCents),
        centsToCsvEuros(row.invoicedCents),
        row.documentCount,
        SCHEDULE_ITEM_STATUS_LABELS[row.status],
      ]);
      break;
    }
    case "couts": {
      const items = await readAll((params) => repository.listDirectCosts(ctx.db, {}, params));
      headers = [
        "Coût",
        "Catégorie",
        "Nature",
        "Client",
        "Projet",
        "Site",
        "Contrat",
        "Intervenant",
        "Date",
        "Montant HT (€)",
        "Récurrence",
      ];
      rows = items.map((row) => [
        row.label,
        COST_CATEGORY_LABELS[row.category],
        COST_NATURE_LABELS[row.nature],
        row.companyName,
        row.projectName,
        row.siteName,
        row.contractName,
        row.memberName,
        row.incurredOn,
        centsToCsvEuros(row.amountCents),
        row.recurringPeriod ? BILLING_PERIOD_LABELS[row.recurringPeriod] : null,
      ]);
      break;
    }
    case "rentabilite-projets":
    case "rentabilite-clients":
    case "rentabilite-sites":
    case "rentabilite-contrats": {
      const scope = (
        {
          "rentabilite-projets": "project",
          "rentabilite-clients": "client",
          "rentabilite-sites": "site",
          "rentabilite-contrats": "contract",
        } as const
      )[dataset as "rentabilite-projets"];
      const items = await readAll((params) => listProfitability(ctx, scope, null, params, now));
      headers = MARGIN_HEADERS;
      rows = marginRows(items);
      break;
    }
    case "rapport-import": {
      if (!options.importId) throw new ValidationError("Précisez l'import.");
      const report = await getImportReport(ctx, options.importId);
      headers = ["Ligne", "Référence", "Motif du refus"];
      rows = report.rejections.map((row) => [row.line, row.externalRef, row.message]);
      break;
    }
  }

  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "export.run",
    entityType: "export",
    metadata: { dataset, rows: rows.length, module: "finance" },
  });

  return {
    filename: `nuera-${dataset}-${today}.csv`,
    csv: toCsv(headers, rows),
    rows: rows.length,
  };
}
