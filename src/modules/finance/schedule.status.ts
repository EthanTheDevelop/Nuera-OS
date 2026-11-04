import {
  SCHEDULE_ITEM_STATUS_LABELS,
  SCHEDULE_ITEM_STATUSES,
  type ScheduleItemStatus,
} from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { SCHEDULE_ITEM_STATUS_LABELS, SCHEDULE_ITEM_STATUSES, type ScheduleItemStatus };

/**
 * Échéance : son état découle de ses factures (`deriveScheduleStatus`). Une facture annulée ou un
 * encaissement corrigé la fait revenir en arrière ; aucun état n'est une impasse.
 */
export const SCHEDULE_TRANSITIONS: TransitionTable<ScheduleItemStatus> = {
  planned: ["invoiced", "paid"],
  invoiced: ["planned", "paid"],
  paid: ["invoiced", "planned"],
};

export function canScheduleTransition(from: ScheduleItemStatus, to: ScheduleItemStatus): boolean {
  return canTransition(SCHEDULE_TRANSITIONS, from, to);
}

export function assertScheduleTransition(from: ScheduleItemStatus, to: ScheduleItemStatus): void {
  assertTransition(SCHEDULE_TRANSITIONS, from, to, SCHEDULE_ITEM_STATUS_LABELS);
}

/**
 * Une échéance est payée quand ses factures payées couvrent son montant : en co-traitance, une seule
 * des deux factures payée la laisse « facturée ».
 */
export function deriveScheduleStatus(input: {
  amountCents: number;
  liveCount: number;
  paidCents: number;
}): ScheduleItemStatus {
  if (input.liveCount === 0) return "planned";
  return input.paidCents >= input.amountCents ? "paid" : "invoiced";
}
