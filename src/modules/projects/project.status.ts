import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectStatus };

/** Projet (§4) : en cours, bloqué et en validation s'atteignent les uns depuis les autres. */
export const PROJECT_TRANSITIONS: TransitionTable<ProjectStatus> = {
  preparation: ["active"],
  active: ["blocked", "in_validation"],
  blocked: ["active", "in_validation"],
  in_validation: ["active", "blocked", "delivered"],
  delivered: ["closed"],
  closed: [],
};

export function canProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return canTransition(PROJECT_TRANSITIONS, from, to);
}

export function assertProjectTransition(from: ProjectStatus, to: ProjectStatus): void {
  assertTransition(PROJECT_TRANSITIONS, from, to, PROJECT_STATUS_LABELS);
}
