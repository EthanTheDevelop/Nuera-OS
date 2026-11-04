"use client";

import { useTransition } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { useToast } from "@/components/ui/toast";
import { changeAppointmentStatusAction } from "../appointment.actions";
import { canAppointmentTransition } from "../appointment.status";
import type { AppointmentView } from "../appointment.service";
import { AppointmentFormButton } from "./appointment-form";

/** Actions d'une ligne : uniquement ce que la machine à états autorise. */
export function AppointmentRowActions({
  appointment,
  members,
}: {
  appointment: AppointmentView;
  members: readonly { id: string; name: string }[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function change(status: "planned" | "done" | "cancelled") {
    startTransition(async () => {
      const state = await changeAppointmentStatusAction(appointment.id, status);
      if (state.status === "error") toast({ message: state.message, tone: "danger" });
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {appointment.status === "planned" ? (
        <AppointmentFormButton
          label="Modifier"
          members={members}
          defaults={{
            id: appointment.id,
            source: appointment.source,
            title: appointment.title,
            kind: appointment.kind,
            startsAt: appointment.startsAt,
            durationMinutes: appointment.durationMinutes,
            channel: appointment.channel,
            location: appointment.location,
            company:
              appointment.companyId && appointment.companyName
                ? { id: appointment.companyId, name: appointment.companyName }
                : null,
            contactId: appointment.contactId,
            projectId: appointment.projectId,
            opportunityId: appointment.opportunityId,
            memberIds: appointment.memberIds,
          }}
        />
      ) : null}
      {canAppointmentTransition(appointment.status, "done") ? (
        <CompactButton variant="quiet" disabled={pending} onClick={() => change("done")}>
          Marquer tenu
        </CompactButton>
      ) : null}
      {canAppointmentTransition(appointment.status, "cancelled") ? (
        <CompactButton variant="quiet" disabled={pending} onClick={() => change("cancelled")}>
          Annuler
        </CompactButton>
      ) : null}
      {canAppointmentTransition(appointment.status, "planned") ? (
        <CompactButton variant="quiet" disabled={pending} onClick={() => change("planned")}>
          Rétablir
        </CompactButton>
      ) : null}
    </div>
  );
}
