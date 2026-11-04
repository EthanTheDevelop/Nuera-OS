"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Checkbox, Field, FormAlert, TextareaField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { CONTACT_ROLE_LABELS, CONTACT_ROLES, type ContactRole } from "@/lib/domain-enums";
import { IDLE_CRM_STATE, type CrmActionState } from "../crm.action-state";
import { createContactAction, updateContactAction } from "../crm.actions";
import { CompanyPicker } from "./company-picker";
import { DuplicateAlert } from "./duplicate-alert";

export interface ContactFormValues {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  roles: readonly ContactRole[];
  isPrimary: boolean;
  notes: string | null;
}

function ContactForm({
  companyId,
  contact,
  companyChoice,
  canMerge,
  onClose,
}: {
  companyId: string | null;
  contact?: ContactFormValues;
  /** Propose le choix du client : annuaire, ou déplacement depuis la fiche du contact. */
  companyChoice?: { company: { id: string; name: string } | null };
  canMerge: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [requestId] = useState(() => crypto.randomUUID());
  // React remet le formulaire à ses valeurs initiales après chaque réponse, y compris une erreur :
  // ce qui vient d'être envoyé devient la valeur initiale des cases.
  const [roles, setRoles] = useState<readonly string[]>(contact?.roles ?? []);
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);

  const [state, action] = useActionState(
    async (previous: CrmActionState, formData: FormData): Promise<CrmActionState> => {
      setRoles(formData.getAll("roles").map(String));
      setIsPrimary(formData.get("isPrimary") === "on");
      const result = contact
        ? await updateContactAction(contact.id, previous, formData)
        : await createContactAction(previous, formData);
      if (result.status === "success") {
        toast({ message: result.message });
        onClose();
      }
      return result;
    },
    IDLE_CRM_STATE,
  );

  return (
    <form action={action} className="contents" noValidate>
      {contact ? null : <input type="hidden" name="id" value={requestId} />}
      {companyId && !contact && !companyChoice ? (
        <input type="hidden" name="companyId" value={companyId} />
      ) : null}
      <ModalRow className="flex flex-col gap-4">
        <FormAlert state={state} />
        {state.duplicate ? (
          <DuplicateAlert duplicate={state.duplicate} onResolved={onClose} canMerge={canMerge} />
        ) : null}
      </ModalRow>
      {companyChoice ? (
        <ModalRow>
          <CompanyPicker
            name="companyId"
            label="Client"
            initial={companyChoice.company}
            error={state.status === "error" ? state.fieldErrors?.companyId?.[0] : undefined}
          />
        </ModalRow>
      ) : null}
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="firstName"
          label="Prénom"
          defaultValue={contact?.firstName}
          autoComplete="off"
          data-autofocus
        />
        <TextField
          state={state}
          name="lastName"
          label="Nom"
          defaultValue={contact?.lastName}
          autoComplete="off"
        />
        <TextField
          state={state}
          name="email"
          label="E-mail"
          type="email"
          autoComplete="off"
          defaultValue={contact?.email ?? ""}
        />
        <TextField
          state={state}
          name="phone"
          label="Téléphone"
          inputMode="tel"
          autoComplete="off"
          hint="Format 06 12 34 56 78 ou +33612345678."
          defaultValue={contact?.phone ?? ""}
        />
        <TextField
          state={state}
          name="jobTitle"
          label="Fonction"
          defaultValue={contact?.jobTitle ?? ""}
          fieldClassName="sm:col-span-2"
        />
      </ModalRow>
      <ModalRow>
        <Field id="contact-roles" label="Rôles">
          <div id="contact-roles" className="grid sm:grid-cols-2">
            {CONTACT_ROLES.map((role) => (
              <Checkbox
                key={role}
                name="roles"
                value={role}
                label={CONTACT_ROLE_LABELS[role]}
                defaultChecked={roles.includes(role)}
              />
            ))}
          </div>
        </Field>
        <Checkbox
          name="isPrimary"
          label="Contact principal"
          description="Celui que la fiche client affiche en premier."
          defaultChecked={isPrimary}
        />
      </ModalRow>
      <ModalRow>
        <TextareaField
          state={state}
          name="notes"
          label="Notes sur la relation"
          rows={3}
          defaultValue={contact?.notes ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <SubmitButton>{contact ? "Enregistrer" : "Ajouter le contact"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

export function ContactFormButton({
  companyId,
  contact,
  companyChoice,
  canMerge,
  label,
  variant = "quiet",
}: {
  companyId: string | null;
  contact?: ContactFormValues;
  companyChoice?: { company: { id: string; name: string } | null };
  canMerge: boolean;
  label: string;
  variant?: "quiet" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton
        variant={variant}
        icon={contact ? "edit" : "plus"}
        onClick={() => setOpen(true)}
      >
        {label}
      </CompactButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          contact
            ? `Modifier ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")}`
            : "Nouveau contact"
        }
        width={640}
      >
        <ContactForm
          companyId={companyId}
          contact={contact}
          companyChoice={companyChoice}
          canMerge={canMerge}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
