import { TICKET_STATUS_LABELS, TICKET_STATUSES, type TicketStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { TICKET_STATUS_LABELS, TICKET_STATUSES, type TicketStatus };

/** Parcours support (§4, A5). Un ticket résolu peut être rouvert, jamais un ticket clôturé. */
export const TICKET_TRANSITIONS: TransitionTable<TicketStatus> = {
  received: ["qualified"],
  qualified: ["in_progress"],
  in_progress: ["resolved"],
  resolved: ["in_progress", "closed"],
  closed: [],
};

export function canTicketTransition(from: TicketStatus, to: TicketStatus): boolean {
  return canTransition(TICKET_TRANSITIONS, from, to);
}

export function assertTicketTransition(from: TicketStatus, to: TicketStatus): void {
  assertTransition(TICKET_TRANSITIONS, from, to, TICKET_STATUS_LABELS);
}
