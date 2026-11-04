import {
  DELIVERABLE_STATUS_LABELS,
  DELIVERABLE_STATUSES,
  type DeliverableStatus,
} from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { DELIVERABLE_STATUS_LABELS, DELIVERABLE_STATUSES, type DeliverableStatus };

/**
 * Livrable. Resoumettre après des retours crée une nouvelle version. Un livrable validé ne change
 * plus, sauf à repartir en brouillon pour une nouvelle version.
 */
export const DELIVERABLE_TRANSITIONS: TransitionTable<DeliverableStatus> = {
  draft: ["to_validate"],
  to_validate: ["validated", "changes_requested"],
  changes_requested: ["to_validate"],
  validated: ["draft"],
};

export function canDeliverableTransition(from: DeliverableStatus, to: DeliverableStatus): boolean {
  return canTransition(DELIVERABLE_TRANSITIONS, from, to);
}

export function assertDeliverableTransition(from: DeliverableStatus, to: DeliverableStatus): void {
  assertTransition(DELIVERABLE_TRANSITIONS, from, to, DELIVERABLE_STATUS_LABELS);
}
