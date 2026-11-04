import { QUOTE_STATUS_LABELS, QUOTE_STATUSES, type QuoteStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { QUOTE_STATUS_LABELS, QUOTE_STATUSES, type QuoteStatus };

/**
 * Devis (§4). Un devis envoyé peut être signé ou refusé directement : la signature DocuSeal
 * n'exige pas de passer par une négociation. Modifier un devis envoyé crée une nouvelle version.
 */
export const QUOTE_TRANSITIONS: TransitionTable<QuoteStatus> = {
  draft: ["sent"],
  sent: ["negotiation", "accepted", "refused", "expired"],
  negotiation: ["accepted", "refused"],
  accepted: [],
  refused: [],
  expired: [],
};

export function canQuoteTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return canTransition(QUOTE_TRANSITIONS, from, to);
}

export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  assertTransition(QUOTE_TRANSITIONS, from, to, QUOTE_STATUS_LABELS);
}
