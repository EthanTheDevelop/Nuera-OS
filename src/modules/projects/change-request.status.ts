import {
  CHANGE_REQUEST_STATUS_LABELS,
  CHANGE_REQUEST_STATUSES,
  type ChangeRequestStatus,
} from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { CHANGE_REQUEST_STATUS_LABELS, CHANGE_REQUEST_STATUSES, type ChangeRequestStatus };

/**
 * Demande de changement : ouverte, puis acceptée (travaux dans le projet), refusée ou transformée
 * en devis. Des travaux acceptés peuvent encore donner un devis ou un avenant (domaine 04.04.02).
 * Une décision prise ne se défait pas : une nouvelle demande la remplace.
 */
export const CHANGE_REQUEST_TRANSITIONS: TransitionTable<ChangeRequestStatus> = {
  open: ["accepted", "refused", "converted"],
  accepted: ["converted"],
  refused: [],
  converted: [],
};

export function canChangeRequestTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): boolean {
  return canTransition(CHANGE_REQUEST_TRANSITIONS, from, to);
}

export function assertChangeRequestTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): void {
  assertTransition(CHANGE_REQUEST_TRANSITIONS, from, to, CHANGE_REQUEST_STATUS_LABELS);
}
