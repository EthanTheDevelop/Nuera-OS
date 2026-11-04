import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

/** Un rendez-vous prévu se tient ou s'annule ; un rendez-vous annulé peut être rétabli. */
export const APPOINTMENT_TRANSITIONS: TransitionTable<AppointmentStatus> = {
  planned: ["done", "cancelled"],
  done: [],
  cancelled: ["planned"],
};

export function assertAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  assertTransition(APPOINTMENT_TRANSITIONS, from, to, APPOINTMENT_STATUS_LABELS);
}

export function canAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return canTransition(APPOINTMENT_TRANSITIONS, from, to);
}
