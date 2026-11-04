"use client";

import { useCallback, useState } from "react";
import { Badge, statusBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DateField, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Menu } from "@/components/ui/popover";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "@/lib/domain-enums";
import type { MemberOption } from "@/modules/team/team.lookup";
import { changeTaskStatusAction, createTaskAction } from "../project.actions";
import { useCommand, useWindowForm } from "./use-project-command";

/** Statut d'une tâche : un badge, qui ouvre les transitions autorisées quand il y en a. */
export function TaskStatusControl({
  taskId,
  title,
  status,
  nextStatuses,
}: {
  taskId: string;
  title: string;
  status: TaskStatus;
  nextStatuses: readonly TaskStatus[];
}) {
  const { run, pending } = useCommand();
  if (nextStatuses.length === 0) return <StatusBadge kind="task" status={status} />;
  const { label, tone } = statusBadge("task", status);
  return (
    <Menu
      label={`Changer le statut de ${title}`}
      placement="bottom-start"
      width={180}
      items={nextStatuses.map((next) => ({
        key: next,
        label: TASK_STATUS_LABELS[next],
        onSelect: () => run(() => changeTaskStatusAction(taskId, next)),
      }))}
      trigger={(props) => (
        <button
          type="button"
          aria-label={`Statut : ${label}. Changer le statut de ${title}`}
          aria-busy={pending || undefined}
          className="hit-44 inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          {...props}
        >
          <Badge tone={tone} className={pending ? "opacity-60" : undefined}>
            {label}
            <Icon name="chevron" size={12} className="ml-1 rotate-90" />
          </Badge>
        </button>
      )}
    />
  );
}

function NewTaskForm({
  projectId,
  members,
  phases,
  onDone,
}: {
  projectId: string;
  members: readonly MemberOption[];
  phases: readonly { id: string; name: string }[];
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(createTaskAction, onDone);
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <input type="hidden" name="projectId" value={projectId} />
        <TextField state={state} name="title" label="Titre" required />
        <TextareaField state={state} name="description" label="Description" rows={3} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField state={state} name="assigneeMemberId" label="Responsable" defaultValue="">
            <option value="">Personne pour l’instant</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </SelectField>
          <DateField state={state} name="dueOn" label="Échéance" />
          <SelectField state={state} name="phaseId" label="Jalon" defaultValue="">
            <option value="">Sans jalon</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </SelectField>
          <SelectField state={state} name="priority" label="Priorité" defaultValue="normal">
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </SelectField>
          <DurationField
            state={state}
            name="estimatedMinutes"
            label="Temps estimé"
            hint="Par exemple 1h30 ou 0,5 j."
          />
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Ajouter la tâche</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function NewTaskButton({
  projectId,
  members,
  phases,
}: {
  projectId: string;
  members: readonly MemberOption[];
  phases: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        Ajouter une tâche
      </Button>
      <Modal open={open} onClose={close} title="Nouvelle tâche">
        <NewTaskForm projectId={projectId} members={members} phases={phases} onDone={close} />
      </Modal>
    </>
  );
}
