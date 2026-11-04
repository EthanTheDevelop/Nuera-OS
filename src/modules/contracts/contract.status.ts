import { CONTRACT_STATUS_LABELS, CONTRACT_STATUSES, type ContractStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { CONTRACT_STATUS_LABELS, CONTRACT_STATUSES, type ContractStatus };

/** Contrat (§4). Un contrat suspendu reprend ou se résilie : il n'est pas une impasse. */
export const CONTRACT_TRANSITIONS: TransitionTable<ContractStatus> = {
  to_start: ["active"],
  active: ["to_review", "suspended", "terminated", "expired"],
  to_review: ["active"],
  suspended: ["active", "terminated"],
  terminated: [],
  expired: [],
};

export function canContractTransition(from: ContractStatus, to: ContractStatus): boolean {
  return canTransition(CONTRACT_TRANSITIONS, from, to);
}

export function assertContractTransition(from: ContractStatus, to: ContractStatus): void {
  assertTransition(CONTRACT_TRANSITIONS, from, to, CONTRACT_STATUS_LABELS);
}
