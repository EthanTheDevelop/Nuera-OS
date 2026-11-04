import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus };

/** Tâche : une tâche faite se rouvre en la repassant en cours, jamais directement à faire. */
export const TASK_TRANSITIONS: TransitionTable<TaskStatus> = {
  todo: ["in_progress", "blocked", "done"],
  in_progress: ["todo", "blocked", "done"],
  blocked: ["todo", "in_progress"],
  done: ["in_progress"],
};

export function canTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return canTransition(TASK_TRANSITIONS, from, to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  assertTransition(TASK_TRANSITIONS, from, to, TASK_STATUS_LABELS);
}
