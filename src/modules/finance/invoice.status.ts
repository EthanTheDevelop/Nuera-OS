import {
  FINANCIAL_DOCUMENT_STATUS_LABELS,
  FINANCIAL_DOCUMENT_STATUSES,
  type FinancialDocumentStatus,
} from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export {
  FINANCIAL_DOCUMENT_STATUS_LABELS as INVOICE_STATUS_LABELS,
  FINANCIAL_DOCUMENT_STATUSES as INVOICE_STATUSES,
  type FinancialDocumentStatus as InvoiceStatus,
};

/**
 * Facture référencée. `overdue` se calcule depuis l'échéance (`markOverdueInvoices`) ; il revient à
 * `issued` si l'échéance est repoussée. `paid → issued` corrige un encaissement saisi par erreur.
 * Une facture annulée reste en base : c'est son archive, elle ne change plus d'état.
 */
export const INVOICE_TRANSITIONS: TransitionTable<FinancialDocumentStatus> = {
  issued: ["overdue", "paid", "cancelled"],
  overdue: ["issued", "paid", "cancelled"],
  paid: ["issued"],
  cancelled: [],
};

export function canInvoiceTransition(
  from: FinancialDocumentStatus,
  to: FinancialDocumentStatus,
): boolean {
  return canTransition(INVOICE_TRANSITIONS, from, to);
}

export function assertInvoiceTransition(
  from: FinancialDocumentStatus,
  to: FinancialDocumentStatus,
): void {
  assertTransition(INVOICE_TRANSITIONS, from, to, FINANCIAL_DOCUMENT_STATUS_LABELS);
}
