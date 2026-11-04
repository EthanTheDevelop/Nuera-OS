"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Checkbox, DateField, FormAlert, SelectField, TextareaField } from "@/components/ui/form";
import { DurationField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { TIME_CATEGORIES, TIME_CATEGORY_LABELS, type TimeCategory } from "@/lib/domain-enums";
import { loadProjectTasksAction, saveTimeEntryAction } from "../time.actions";
import type { TimeEntryOptions, TimeEntryView } from "../time.service";

const NON_BILLABLE_BY_DEFAULT: readonly TimeCategory[] = ["prospecting", "admin"];

/**
 * Les listes de choix ne portent que le travail ouvert. Une saisie ancienne garde son rattachement :
 * sans cette option, sa valeur disparaîtrait du champ et l'enregistrement la détacherait sans le dire.
 */
function withCurrent<T extends { id: string }>(
  options: readonly T[],
  id: string | null | undefined,
  build: (id: string) => T,
): readonly T[] {
  if (!id || options.some((option) => option.id === id)) return options;
  return [build(id), ...options];
}

function EntryForm({
  options,
  entry,
  today,
  defaultMemberId,
  onDone,
}: {
  options: TimeEntryOptions;
  entry?: TimeEntryView;
  today: string;
  defaultMemberId?: string;
  onDone: () => void;
}) {
  const [state, action] = useActionState(saveTimeEntryAction, IDLE_ACTION_STATE);
  useActionToast(state);

  const [projectId, setProjectId] = useState(entry?.projectId ?? "");
  const [loaded, setLoaded] = useState<{
    projectId: string;
    tasks: { id: string; label: string }[];
  } | null>(null);
  const [billable, setBillable] = useState(entry?.billable ?? true);

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

  const companyPrefix = entry?.companyName ? `${entry.companyName} · ` : "";
  const projectOptions = withCurrent(options.projects, entry?.projectId, (id) => ({
    id,
    label: `${companyPrefix}${entry?.projectName ?? "Projet"}`,
  }));
  const ticketOptions = withCurrent(options.tickets, entry?.ticketId, (id) => ({
    id,
    label: `${entry?.ticketNumber} · ${entry?.ticketSubject}`,
  }));
  const contractOptions = withCurrent(options.contracts, entry?.contractId, (id) => ({
    id,
    label: `${companyPrefix}${entry?.contractName ?? "Contrat"}`,
  }));
  const memberOptions = withCurrent(options.members, entry?.memberId, (id) => ({
    id,
    fullName: entry?.memberName ?? "Membre",
  }));
  const visibleTasks = withCurrent(
    loaded?.projectId === projectId ? loaded.tasks : [],
    entry?.projectId === projectId ? entry?.taskId : null,
    (id) => ({ id, label: entry?.taskTitle ?? "Tâche" }),
  );

  return (
    <form action={action} className="contents">
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <FormAlert state={state} />
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <DateField
          state={state}
          name="workOn"
          label="Date"
          required
          max={today}
          defaultValue={entry?.workOn ?? today}
          data-autofocus
        />
        <DurationField
          state={state}
          name="minutes"
          label="Durée"
          required
          hint="1h30, 90 ou 0,5 j"
          defaultMinutes={entry?.minutes ?? null}
        />
      </ModalRow>
      {options.members.length > 0 ? (
        <ModalRow>
          <SelectField
            state={state}
            name="memberId"
            label="Intervenant"
            defaultValue={entry?.memberId ?? defaultMemberId ?? options.ownMemberId ?? ""}
          >
            {options.ownMemberId ? null : <option value="">Choisir un membre</option>}
            {memberOptions.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </SelectField>
        </ModalRow>
      ) : null}
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
          defaultValue={entry?.projectId === projectId ? (entry?.taskId ?? "") : ""}
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
          defaultValue={entry?.ticketId ?? ""}
        >
          <option value="">Sans demande</option>
          {ticketOptions.map((ticket) => (
            <option key={ticket.id} value={ticket.id}>
              {ticket.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="contractId"
          label="Contrat"
          defaultValue={entry?.contractId ?? ""}
        >
          <option value="">Sans contrat</option>
          {contractOptions.map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.label}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="grid items-end gap-4 sm:grid-cols-2">
        <SelectField
          state={state}
          name="category"
          label="Catégorie"
          defaultValue={entry?.category ?? "production"}
          onChange={(event) =>
            setBillable(!NON_BILLABLE_BY_DEFAULT.includes(event.target.value as TimeCategory))
          }
        >
          {TIME_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {TIME_CATEGORY_LABELS[category]}
            </option>
          ))}
        </SelectField>
        <Checkbox
          name="billable"
          label="Temps facturable"
          checked={billable}
          onChange={(event) => setBillable(event.target.checked)}
        />
      </ModalRow>
      <ModalRow>
        <TextareaField
          state={state}
          name="note"
          label="Note"
          rows={2}
          maxLength={500}
          defaultValue={entry?.note ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>{entry ? "Enregistrer" : "Saisir ce temps"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** « Saisir du temps » (non dessiné) : formulaire complet, par projet, tâche, demande ou contrat. */
export function TimeEntryButton({
  options,
  today,
  defaultMemberId,
  variant = "default",
}: {
  options: TimeEntryOptions;
  today: string;
  defaultMemberId?: string;
  variant?: "default" | "accent";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        Saisir du temps
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Saisir du temps" width={640}>
        <EntryForm
          options={options}
          today={today}
          defaultMemberId={defaultMemberId}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function TimeEntryEditButton({
  entry,
  options,
  today,
}: {
  entry: TimeEntryView;
  options: TimeEntryOptions;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Modifier
      </CompactButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Modifier ce temps" width={640}>
        <EntryForm options={options} entry={entry} today={today} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
