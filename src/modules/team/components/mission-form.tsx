"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateField, FormAlert, SelectField, TextField } from "@/components/ui/form";
import { MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { loadProjectTasksAction } from "@/modules/time/time.actions";
import { saveMissionAction } from "../team.actions";
import type { MissionFormOptions, MissionView } from "../team.service";

/**
 * Les listes de choix ne portent que le travail ouvert et les membres actifs. Une mission livrée garde
 * ses liens : sans cette option, leur valeur disparaîtrait du champ et l'enregistrement les effacerait.
 */
function withCurrent<T extends { id: string }>(
  options: readonly T[],
  id: string | null | undefined,
  build: (id: string) => T,
): readonly T[] {
  if (!id || options.some((option) => option.id === id)) return options;
  return [build(id), ...options];
}

function MissionForm({
  options,
  mission,
  defaultMemberId,
  showCosts,
  onDone,
}: {
  options: MissionFormOptions;
  mission?: MissionView;
  defaultMemberId?: string;
  showCosts: boolean;
  onDone: () => void;
}) {
  const [state, action] = useActionState(saveMissionAction, IDLE_ACTION_STATE);
  useActionToast(state);
  const [projectId, setProjectId] = useState(mission?.projectId ?? "");
  const [loaded, setLoaded] = useState<{
    projectId: string;
    tasks: { id: string; label: string }[];
  } | null>(null);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  useEffect(() => {
    let current = true;
    if (projectId) {
      void loadProjectTasksAction(projectId).then((rows) => {
        if (current) setLoaded({ projectId, tasks: rows });
      });
    }
    return () => {
      current = false;
    };
  }, [projectId]);

  const companyPrefix = mission?.companyName ? `${mission.companyName} · ` : "";
  const memberOptions = withCurrent(options.members, mission?.memberId, (id) => ({
    id,
    userId: null,
    fullName: mission?.memberName ?? "Membre",
    kind: mission?.memberKind ?? "employee",
    title: null,
  }));
  const projectOptions = withCurrent(options.projects, mission?.projectId, (id) => ({
    id,
    label: `${companyPrefix}${mission?.projectName ?? "Projet"}`,
  }));
  const ticketOptions = withCurrent(options.tickets, mission?.ticketId, (id) => ({
    id,
    label: `${mission?.ticketNumber} · ${mission?.ticketSubject}`,
  }));
  const visibleTasks = withCurrent(
    loaded?.projectId === projectId ? loaded.tasks : [],
    mission?.projectId === projectId ? mission?.taskId : null,
    (id) => ({ id, label: mission?.taskTitle ?? "Tâche" }),
  );

  return (
    <form action={action} className="contents">
      {mission ? <input type="hidden" name="id" value={mission.id} /> : null}
      <FormAlert state={state} />
      <ModalRow>
        <TextField
          state={state}
          name="title"
          label="Mission"
          required
          defaultValue={mission?.title}
          autoComplete="off"
          data-autofocus
        />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <SelectField
          state={state}
          name="memberId"
          label="Intervenant"
          required
          defaultValue={mission?.memberId ?? defaultMemberId ?? ""}
        >
          <option value="">Choisir un intervenant</option>
          {memberOptions.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </SelectField>
        <DateField
          state={state}
          name="dueOn"
          label="Échéance"
          defaultValue={mission?.dueOn ?? ""}
        />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <SelectField
          state={state}
          name="projectId"
          label="Projet"
          defaultValue={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Sans projet</option>
          {projectOptions.map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`${projectId}-${visibleTasks.length}`}
          state={state}
          name="taskId"
          label="Tâche"
          defaultValue={mission?.projectId === projectId ? (mission?.taskId ?? "") : ""}
          disabled={visibleTasks.length === 0}
        >
          <option value="">{projectId ? "Tout le projet" : "Choisissez un projet"}</option>
          {visibleTasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.label}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <SelectField
          state={state}
          name="ticketId"
          label="Demande"
          defaultValue={mission?.ticketId ?? ""}
        >
          <option value="">Sans demande</option>
          {ticketOptions.map((ticket) => (
            <option key={ticket.id} value={ticket.id}>
              {ticket.label}
            </option>
          ))}
        </SelectField>
        <TextField
          state={state}
          name="deliverableLabel"
          label="Livrable attendu"
          defaultValue={mission?.deliverableLabel ?? ""}
        />
      </ModalRow>
      {showCosts ? (
        <ModalRow className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            state={state}
            name="plannedCostCents"
            label="Coût prévu HT"
            defaultCents={mission?.plannedCostCents ?? null}
          />
          <MoneyField
            state={state}
            name="committedCostCents"
            label="Coût engagé HT"
            defaultCents={mission?.committedCostCents ?? null}
          />
        </ModalRow>
      ) : null}
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>{mission ? "Enregistrer" : "Affecter"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** « Affecter une mission » (écran 22, formulaire non dessiné) ou modifier une mission existante. */
export function MissionFormButton({
  options,
  mission,
  defaultMemberId,
  showCosts,
  label,
  variant = "accent",
}: {
  options: MissionFormOptions;
  mission?: MissionView;
  defaultMemberId?: string;
  showCosts: boolean;
  label: string;
  variant?: "default" | "accent";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={mission ? "Modifier la mission" : "Affecter une mission"}
        width={640}
      >
        <MissionForm
          options={options}
          mission={mission}
          defaultMemberId={defaultMemberId}
          showCosts={showCosts}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
