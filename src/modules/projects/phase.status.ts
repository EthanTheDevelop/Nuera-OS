import { PHASE_STATUS_LABELS, PHASE_STATUSES, type PhaseStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { PHASE_STATUS_LABELS, PHASE_STATUSES, type PhaseStatus };

/** Jalon : à venir, en cours, fait. Un jalon fait se rouvre ; on ne saute pas une étape. */
export const PHASE_TRANSITIONS: TransitionTable<PhaseStatus> = {
  todo: ["in_progress"],
  in_progress: ["todo", "done"],
  done: ["in_progress"],
};

export function canPhaseTransition(from: PhaseStatus, to: PhaseStatus): boolean {
  return canTransition(PHASE_TRANSITIONS, from, to);
}

export function assertPhaseTransition(from: PhaseStatus, to: PhaseStatus): void {
  assertTransition(PHASE_TRANSITIONS, from, to, PHASE_STATUS_LABELS);
}
