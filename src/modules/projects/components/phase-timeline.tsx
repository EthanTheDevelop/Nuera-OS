"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Checkbox, DateField, FormAlert, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { StepTimeline, type StepState } from "@/components/ui/step-timeline";
import { Tile } from "@/components/ui/tile";
import { PHASE_STATUS_LABELS, type PhaseStatus } from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import { canPhaseTransition } from "../phase.status";
import { changePhaseStatusAction, createPhaseAction, updatePhaseAction } from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { useCommand, useWindowForm } from "./use-project-command";

type ProjectPhase = ProjectDetail["phases"][number];

const STATE: Record<PhaseStatus, StepState> = {
  todo: "todo",
  in_progress: "current",
  done: "done",
};

function transitionLabel(from: PhaseStatus, to: PhaseStatus): string {
  if (to === "done") return "Terminer le jalon";
  if (to === "todo") return "Remettre à venir";
  return from === "done" ? "Rouvrir le jalon" : "Démarrer le jalon";
}

function PhaseForm({
  projectId,
  phase,
  onDone,
}: {
  projectId: string;
  phase?: ProjectPhase;
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(
    phase ? updatePhaseAction : createPhaseAction,
    onDone,
  );
  const { run, pending } = useCommand();
  const nextStatuses = phase
    ? (["todo", "in_progress", "done"] as const).filter((status) =>
        canPhaseTransition(phase.status, status),
      )
    : [];
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        {phase ? (
          <input type="hidden" name="phaseId" value={phase.id} />
        ) : (
          <input type="hidden" name="projectId" value={projectId} />
        )}
        <TextField
          state={state}
          name="name"
          label="Nom du jalon"
          required
          defaultValue={phase?.name}
        />
        <DateField state={state} name="dueOn" label="Échéance" defaultValue={phase?.dueOn ?? ""} />
        <Checkbox
          name="clientVisible"
          label="Visible dans l’espace client"
          defaultChecked={phase?.clientVisible ?? true}
        />
        {phase && nextStatuses.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">État : {PHASE_STATUS_LABELS[phase.status]}</span>
            {nextStatuses.map((status) => (
              <CompactButton
                key={status}
                variant="secondary"
                loading={pending}
                onClick={() => run(() => changePhaseStatusAction(phase.id, status), onDone)}
              >
                {transitionLabel(phase.status, status)}
              </CompactButton>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>{phase ? "Enregistrer" : "Ajouter le jalon"}</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

/** Jalons de l'écran 17 : frise, ouverture d'un jalon pour le dater ou changer son état. */
export function PhaseTimeline({
  projectId,
  phases,
  editable,
}: {
  projectId: string;
  phases: readonly ProjectPhase[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const close = useCallback(() => setEditing(null), []);
  const current = phases.find((phase) => phase.id === editing);

  return (
    <Tile
      icon="flag"
      title="Jalons"
      className="gap-3 rounded-lg p-6"
      aside={
        <span className="flex items-center gap-3 text-xs text-muted">
          {phases.length} étape{phases.length > 1 ? "s" : ""}
          {editable ? (
            <CompactButton variant="quiet" icon="plus" onClick={() => setEditing("new")}>
              Ajouter
            </CompactButton>
          ) : null}
        </span>
      }
    >
      {phases.length === 0 ? (
        <p className="text-sm text-muted">Aucun jalon pour l’instant.</p>
      ) : (
        <StepTimeline
          label="Jalons du projet"
          steps={phases.map((phase) => ({
            id: phase.id,
            state: STATE[phase.status],
            title: editable ? (
              <button
                type="button"
                onClick={() => setEditing(phase.id)}
                className="rounded-sm text-left after:absolute after:inset-0 hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus"
              >
                {phase.name}
              </button>
            ) : (
              phase.name
            ),
            detail: `${phase.dueOn ? `${formatDateShort(phase.dueOn)} · ` : ""}${PHASE_STATUS_LABELS[phase.status].toLocaleLowerCase("fr-FR")}`,
          }))}
        />
      )}
      <Modal
        open={editing !== null}
        onClose={close}
        width={480}
        title={current ? current.name : "Nouveau jalon"}
      >
        <PhaseForm key={editing ?? ""} projectId={projectId} phase={current} onDone={close} />
      </Modal>
    </Tile>
  );
}
