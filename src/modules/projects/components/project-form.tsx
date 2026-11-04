"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateField, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { fieldError, type ActionState } from "@/lib/action-state";
import {
  OFFER_ACTIVITIES,
  OFFER_ACTIVITY_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/domain-enums";
import { CompanyPicker } from "@/modules/crm/components/company-picker";
import type { MemberOption } from "@/modules/team/team.lookup";
import { createProjectAction, updateProjectAction } from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { useWindowForm } from "./use-project-command";

function ProjectFields({
  state,
  members,
  project,
}: {
  state: ActionState;
  members: readonly MemberOption[];
  project?: ProjectDetail;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        state={state}
        name="name"
        label="Nom du projet"
        required
        defaultValue={project?.name}
        fieldClassName="sm:col-span-2"
      />
      <SelectField
        state={state}
        name="activity"
        label="Activité"
        defaultValue={project?.activity ?? ""}
      >
        <option value="">Non précisée</option>
        {OFFER_ACTIVITIES.map((activity) => (
          <option key={activity} value={activity}>
            {OFFER_ACTIVITY_LABELS[activity]}
          </option>
        ))}
      </SelectField>
      <SelectField
        state={state}
        name="priority"
        label="Priorité"
        defaultValue={project?.priority ?? "normal"}
      >
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {PRIORITY_LABELS[priority]}
          </option>
        ))}
      </SelectField>
      <SelectField
        state={state}
        name="ownerMemberId"
        label="Responsable"
        defaultValue={project?.ownerMemberId ?? ""}
        fieldClassName="sm:col-span-2"
      >
        <option value="">Personne pour l’instant</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.fullName}
          </option>
        ))}
      </SelectField>
      <DateField state={state} name="startOn" label="Début" defaultValue={project?.startOn ?? ""} />
      <DateField
        state={state}
        name="dueOn"
        label="Mise en ligne prévue"
        defaultValue={project?.dueOn ?? ""}
      />
      <MoneyField
        state={state}
        name="budgetCents"
        label="Budget HT"
        defaultCents={project?.budgetCents ?? null}
      />
      <DurationField
        state={state}
        name="estimatedMinutes"
        label="Temps vendu"
        hint="Par exemple 12 j ou 90."
        defaultMinutes={project?.estimatedMinutes ?? null}
      />
      <TextareaField
        state={state}
        name="objective"
        label="Objectif"
        rows={2}
        defaultValue={project?.objective ?? ""}
        fieldClassName="sm:col-span-2"
      />
      <TextareaField
        state={state}
        name="scope"
        label="Périmètre"
        rows={3}
        defaultValue={project?.scope ?? ""}
        fieldClassName="sm:col-span-2"
      />
    </div>
  );
}

function FormFooter({ onCancel, label }: { onCancel: () => void; label: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-3">
      <Button onClick={onCancel}>Annuler</Button>
      <SubmitButton>{label}</SubmitButton>
    </div>
  );
}

function NewProjectForm({
  members,
  onDone,
}: {
  members: readonly MemberOption[];
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(createProjectAction, onDone);
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <CompanyPicker
          name="companyId"
          label="Client"
          error={fieldError(state, "companyId")}
          hint="Le plan de production suit l’activité : son modèle s’il existe, sinon les cinq jalons standards."
        />
        <ProjectFields state={state} members={members} />
        <FormFooter onCancel={onDone} label="Créer le projet" />
      </form>
    </ModalRow>
  );
}

export function NewProjectButton({ members }: { members: readonly MemberOption[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
        Nouveau projet
      </Button>
      <Modal open={open} onClose={close} title="Nouveau projet">
        <NewProjectForm members={members} onDone={close} />
      </Modal>
    </>
  );
}

function EditProjectForm({
  project,
  members,
  onDone,
}: {
  project: ProjectDetail;
  members: readonly MemberOption[];
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(updateProjectAction, onDone);
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <input type="hidden" name="projectId" value={project.id} />
        <ProjectFields state={state} members={members} project={project} />
        <FormFooter onCancel={onDone} label="Enregistrer" />
      </form>
    </ModalRow>
  );
}

export function EditProjectButton({
  project,
  members,
}: {
  project: ProjectDetail;
  members: readonly MemberOption[];
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Modifier</Button>
      <Modal open={open} onClose={close} title="Modifier le projet">
        <EditProjectForm project={project} members={members} onDone={close} />
      </Modal>
    </>
  );
}
