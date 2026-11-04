"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  MEMBER_KIND_LABELS,
  MEMBER_KINDS,
  MEMBER_STATUS_LABELS,
  MEMBER_STATUSES,
  type MemberKind,
} from "@/lib/domain-enums";
import { saveMemberAction } from "../team.actions";
import type { MemberView } from "../team.service";

function MemberForm({
  member,
  showCosts,
  defaultKind = "employee",
  onDone,
}: {
  member?: MemberView;
  showCosts: boolean;
  defaultKind?: MemberKind;
  onDone: () => void;
}) {
  const [state, action] = useActionState(saveMemberAction, IDLE_ACTION_STATE);
  useActionToast(state);
  const [kind, setKind] = useState<MemberKind>(member?.kind ?? defaultKind);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="contents">
      {member ? <input type="hidden" name="id" value={member.id} /> : null}
      <FormAlert state={state} />
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="fullName"
          label="Nom complet"
          required
          defaultValue={member?.fullName}
          autoComplete="off"
          data-autofocus
        />
        <SelectField
          state={state}
          name="kind"
          label="Type"
          defaultValue={kind}
          onChange={(event) => setKind(event.target.value as MemberKind)}
        >
          {MEMBER_KINDS.map((item) => (
            <option key={item} value={item}>
              {MEMBER_KIND_LABELS[item]}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField state={state} name="title" label="Fonction" defaultValue={member?.title ?? ""} />
        <TextField
          state={state}
          name="specialty"
          label="Spécialité"
          defaultValue={member?.specialty ?? ""}
        />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="email"
          type="email"
          label="E-mail"
          autoComplete="off"
          defaultValue={member?.email ?? ""}
        />
        <TextField
          state={state}
          name="phone"
          label="Téléphone"
          autoComplete="off"
          defaultValue={member?.phone ?? ""}
        />
      </ModalRow>
      <ModalRow>
        <TextField
          state={state}
          name="skills"
          label="Compétences"
          hint="Séparées par des virgules."
          defaultValue={member?.skills?.join(", ") ?? ""}
        />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <DurationField
          state={state}
          name="weeklyCapacityMinutes"
          label="Capacité par semaine"
          hint="Par exemple 35 h."
          required
          defaultMinutes={member?.weeklyCapacityMinutes ?? null}
        />
        <SelectField
          state={state}
          name="status"
          label="Statut"
          defaultValue={member?.status ?? "active"}
        >
          {MEMBER_STATUSES.map((item) => (
            <option key={item} value={item}>
              {MEMBER_STATUS_LABELS[item]}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      {showCosts ? (
        <>
          <ModalRow className="grid gap-4 sm:grid-cols-2">
            <MoneyField
              state={state}
              name="hourlyCostCents"
              label="Coût horaire HT"
              hint="Figé sur chaque saisie de temps."
              defaultCents={member?.hourlyCostCents ?? null}
            />
            <MoneyField
              state={state}
              name="dayRateCents"
              label="Tarif jour HT"
              defaultCents={member?.dayRateCents ?? null}
            />
          </ModalRow>
          <ModalRow>
            <TextareaField
              state={state}
              name="conditions"
              label="Conditions"
              rows={2}
              defaultValue={member?.conditions ?? ""}
            />
          </ModalRow>
        </>
      ) : null}
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>{member ? "Enregistrer" : "Ajouter ce membre"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

export function MemberFormButton({
  member,
  showCosts,
  label,
  defaultKind,
  variant = "default",
}: {
  member?: MemberView;
  showCosts: boolean;
  label: string;
  defaultKind?: MemberKind;
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
        title={member ? "Modifier la fiche" : "Nouveau membre"}
        width={640}
      >
        <MemberForm
          member={member}
          showCosts={showCosts}
          defaultKind={defaultKind}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
