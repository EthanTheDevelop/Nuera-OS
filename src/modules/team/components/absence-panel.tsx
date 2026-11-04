"use client";

import { useActionState, useEffect, useState } from "react";
import { EmptyState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateField, FormAlert, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast, useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { formatDateShort } from "@/lib/format";
import { addAbsenceAction, removeAbsenceAction } from "../team.actions";

interface Absence {
  id: string;
  startOn: string;
  endOn: string;
  reason: string | null;
}

function AbsenceForm({
  memberId,
  today,
  onDone,
}: {
  memberId: string;
  today: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState(addAbsenceAction, IDLE_ACTION_STATE);
  useActionToast(state);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="contents">
      <input type="hidden" name="memberId" value={memberId} />
      <FormAlert state={state} />
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <DateField
          state={state}
          name="startOn"
          label="Du"
          required
          defaultValue={today}
          data-autofocus
        />
        <DateField state={state} name="endOn" label="Au" required defaultValue={today} />
      </ModalRow>
      <ModalRow>
        <TextField state={state} name="reason" label="Motif" placeholder="Congés, salon…" />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Ajouter</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** Absences d'un membre : elles réduisent sa capacité nette, jour par jour. */
export function AbsencePanel({
  memberId,
  absences,
  today,
  canManage,
}: {
  memberId: string;
  absences: readonly Absence[];
  today: string;
  canManage: boolean;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Absence | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {absences.length === 0 ? (
        <EmptyState compact icon="calendar" title="Aucune absence déclarée" />
      ) : (
        <ul className="flex flex-col gap-2">
          {absences.map((absence) => (
            <li
              key={absence.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
            >
              <span className="min-w-0 text-text">
                <span className="tabular">
                  {absence.startOn === absence.endOn
                    ? formatDateShort(absence.startOn)
                    : `${formatDateShort(absence.startOn)} au ${formatDateShort(absence.endOn)}`}
                </span>
                {absence.reason ? <span className="text-muted"> · {absence.reason}</span> : null}
              </span>
              {canManage ? (
                <CompactButton variant="quiet" onClick={() => setRemoving(absence)}>
                  Retirer
                </CompactButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <div>
          <CompactButton variant="secondary" icon="plus" onClick={() => setAdding(true)}>
            Ajouter une absence
          </CompactButton>
          <Modal
            open={adding}
            onClose={() => setAdding(false)}
            title="Ajouter une absence"
            width={480}
          >
            <AbsenceForm memberId={memberId} today={today} onDone={() => setAdding(false)} />
          </Modal>
          <ConfirmDialog
            open={removing !== null}
            title="Retirer cette absence ?"
            description="La capacité de ce membre sera recalculée."
            confirmLabel="Retirer"
            cancelLabel="Annuler"
            onCancel={() => setRemoving(null)}
            onConfirm={async () => {
              if (removing) {
                const result = await removeAbsenceAction(removing.id);
                if (result.status === "error") toast({ message: result.message, tone: "danger" });
                if (result.status === "success") toast({ message: result.message });
              }
              setRemoving(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
