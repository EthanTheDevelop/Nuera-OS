import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { computeAmounts, computeTotals, type CalcLine } from "./quote.calc";
import { SIGNER_ROLE } from "./quote.rules";

/**
 * Document présenté au client : aperçu imprimable et HTML envoyé à DocuSeal partagent ce modèle.
 * Il ne contient NI coût interne NI rentabilité : ces données restent dans Nuera OS.
 *
 * Nuera OS n'émet pas le document légal (domaine 04) : la mention de bas de page le rappelle, et
 * les références Indy s'affichent quand elles existent.
 */
export interface QuoteDocumentLine extends CalcLine {
  id: string;
  label: string;
  unitLabel: string | null;
}

export interface QuoteDocumentInput {
  number: string;
  title: string;
  issuedByNote: string | null;
  indyReference: string | null;
  company: {
    name: string;
    addressLine: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  };
  version: {
    version: number;
    scope: string | null;
    exclusions: string | null;
    conditions: string | null;
    validUntil: string | null;
    depositPercent: number | null;
    totalCents: number;
    estimatedCostCents: number;
    taxPercent: number;
    sentAt: Date | null;
    createdAt: Date;
  };
  lines: readonly QuoteDocumentLine[];
}

export const QUOTE_DOCUMENT_NOTICE =
  "Proposition commerciale établie par Nuera Studio. Le document officiel et les factures sont émis dans l'outil de facturation de l'agence.";

export interface QuoteDocumentRow {
  id: string;
  label: string;
  unit: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  recurring: boolean;
}

export interface QuoteDocumentModel {
  heading: string;
  number: string;
  title: string;
  versionLabel: string;
  dateLabel: string;
  issuedByNote: string | null;
  indyReference: string | null;
  companyName: string;
  companyLines: string[];
  rows: QuoteDocumentRow[];
  summary: { label: string; value: string; strong?: boolean }[];
  sections: { title: string; body: string }[];
  validityLabel: string | null;
}

export function buildQuoteDocument(input: QuoteDocumentInput): QuoteDocumentModel {
  const { version, company } = input;
  const amounts = computeAmounts(version);
  const { recurringCents } = computeTotals(input.lines);
  const postal = [company.postalCode, company.city].filter(Boolean).join(" ");

  const summary: QuoteDocumentModel["summary"] = [
    { label: "Total HT", value: formatCents(amounts.totalCents), strong: true },
    { label: `TVA ${version.taxPercent} %`, value: formatCents(amounts.taxCents) },
    { label: "Total TTC", value: formatCents(amounts.totalWithTaxCents), strong: true },
  ];
  if (version.depositPercent) {
    summary.push({
      label: `Acompte ${version.depositPercent} % HT`,
      value: formatCents(amounts.depositCents),
    });
  }
  if (recurringCents > 0) {
    summary.push({ label: "Récurrent HT, hors total", value: `${formatCents(recurringCents)}` });
  }

  const sections: { title: string; body: string }[] = [];
  if (version.scope) sections.push({ title: "Périmètre", body: version.scope });
  if (version.exclusions) sections.push({ title: "Exclusions", body: version.exclusions });
  if (version.conditions) sections.push({ title: "Conditions", body: version.conditions });

  return {
    heading: `Devis ${input.number}`,
    number: input.number,
    title: input.title,
    versionLabel: `Version ${version.version}`,
    dateLabel: formatDate(version.sentAt ?? version.createdAt),
    issuedByNote: input.issuedByNote,
    indyReference: input.indyReference,
    companyName: company.name,
    companyLines: [company.addressLine, postal, company.country].flatMap((line) =>
      line ? [line] : [],
    ),
    rows: input.lines.map((line) => ({
      id: line.id,
      label: line.label,
      unit: line.unitLabel ?? "",
      quantity: line.quantity,
      unitPrice: formatCents(line.unitPriceCents),
      amount: formatCents(line.quantity * line.unitPriceCents),
      recurring: line.recurring,
    })),
    summary,
    sections,
    validityLabel: version.validUntil ? `Valable jusqu'au ${formatDate(version.validUntil)}` : null,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const multiline = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>");

/**
 * HTML envoyé à `POST /submissions/html`, balises de champ d'après la documentation DocuSeal.
 * Toute valeur saisie est échappée : aucune ne peut injecter une balise de champ ni de script.
 */
export function renderSignatureHtml(model: QuoteDocumentModel): string {
  const rows = model.rows
    .map(
      (row) => `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #d9dce8">${escapeHtml(row.label)}${
    row.unit ? ` <span style="color:#5a6072">(${escapeHtml(row.unit)})</span>` : ""
  }</td>
  <td style="padding:8px 0;border-bottom:1px solid #d9dce8;text-align:right">${row.quantity}</td>
  <td style="padding:8px 0;border-bottom:1px solid #d9dce8;text-align:right">${escapeHtml(row.unitPrice)}</td>
  <td style="padding:8px 0;border-bottom:1px solid #d9dce8;text-align:right">${escapeHtml(row.amount)}</td>
</tr>`,
    )
    .join("\n");

  const summary = model.summary
    .map(
      (line) =>
        `<tr><td style="padding:4px 0">${escapeHtml(line.label)}</td><td style="padding:4px 0;text-align:right${
          line.strong ? ";font-weight:600" : ""
        }">${escapeHtml(line.value)}</td></tr>`,
    )
    .join("\n");

  const sections = model.sections
    .map(
      (section) =>
        `<h2 style="font-size:14px;margin:20px 0 4px">${escapeHtml(section.title)}</h2><p style="margin:0">${multiline(section.body)}</p>`,
    )
    .join("\n");

  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#141730">
<h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(model.heading)}</h1>
<p style="margin:0">${escapeHtml(model.title)} · ${escapeHtml(model.versionLabel)} · ${escapeHtml(model.dateLabel)}</p>
${model.issuedByNote ? `<p style="margin:4px 0 0;color:#5a6072">${escapeHtml(model.issuedByNote)}</p>` : ""}
${model.indyReference ? `<p style="margin:4px 0 0;color:#5a6072">Référence : ${escapeHtml(model.indyReference)}</p>` : ""}
<h2 style="font-size:14px;margin:20px 0 4px">${escapeHtml(model.companyName)}</h2>
${model.companyLines.map((line) => `<p style="margin:0">${escapeHtml(line)}</p>`).join("\n")}
<table style="width:100%;border-collapse:collapse;margin-top:20px">
<thead><tr>
  <th style="text-align:left;padding:8px 0;border-bottom:1px solid #141730">Prestation</th>
  <th style="text-align:right;padding:8px 0;border-bottom:1px solid #141730">Quantité</th>
  <th style="text-align:right;padding:8px 0;border-bottom:1px solid #141730">Prix unitaire HT</th>
  <th style="text-align:right;padding:8px 0;border-bottom:1px solid #141730">Montant HT</th>
</tr></thead>
<tbody>
${rows}
</tbody>
</table>
<table style="width:50%;margin:16px 0 0 auto;border-collapse:collapse">
${summary}
</table>
${sections}
${model.validityLabel ? `<p style="margin:20px 0 0">${escapeHtml(model.validityLabel)}</p>` : ""}
<p style="margin:28px 0 8px;font-weight:600">Bon pour accord</p>
<p style="margin:0 0 4px">Date :
  <date-field name="Date de signature" role="${SIGNER_ROLE}" style="width: 120px; height: 20px; display: inline-block;"></date-field>
</p>
<signature-field name="Signature" role="${SIGNER_ROLE}" style="width: 220px; height: 90px; display: inline-block;"></signature-field>
<p style="margin:28px 0 0;font-size:11px;color:#5a6072">${escapeHtml(QUOTE_DOCUMENT_NOTICE)}</p>
</div>`;
}
