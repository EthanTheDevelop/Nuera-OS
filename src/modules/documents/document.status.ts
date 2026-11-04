import { DOCUMENT_STATUS_LABELS, DOCUMENT_STATUSES, type DocumentStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { DOCUMENT_STATUS_LABELS, DOCUMENT_STATUSES, type DocumentStatus };

/**
 * Document. Un document ordinaire vit en `final` ; ceux qui demandent un accord passent par
 * `to_validate`, `validated`, puis `signed` s'il y a lieu. Revenir à `draft` reste possible : une
 * nouvelle version repart de là (voir `statusAfterNewVersion`).
 */
export const DOCUMENT_TRANSITIONS: TransitionTable<DocumentStatus> = {
  draft: ["to_validate", "final"],
  to_validate: ["draft", "validated"],
  validated: ["draft", "signed", "final"],
  signed: ["draft", "final"],
  final: ["draft"],
};

export function canDocumentTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return canTransition(DOCUMENT_TRANSITIONS, from, to);
}

export function assertDocumentTransition(from: DocumentStatus, to: DocumentStatus): void {
  assertTransition(DOCUMENT_TRANSITIONS, from, to, DOCUMENT_STATUS_LABELS);
}

/** Un accord ou une signature porte sur une version : un nouveau fichier les fait retomber. */
export function statusAfterNewVersion(current: DocumentStatus): DocumentStatus {
  return current === "to_validate" || current === "validated" || current === "signed"
    ? "draft"
    : current;
}
