"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { COMPANY_STATUS_LABELS, COMPANY_STATUSES } from "@/lib/domain-enums";
import type { MemberOption } from "@/modules/team/team.lookup";
import { IDLE_CRM_STATE, type CrmActionState } from "../crm.action-state";
import { createCompanyAction, updateCompanyAction } from "../crm.actions";
import { DuplicateAlert } from "./duplicate-alert";

/** Ce que le formulaire relit d'une fiche existante. */
export interface CompanyFormValues {
  id: string;
  name: string;
  domain: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  status: string;
  activity: string | null;
  siren: string | null;
  phone: string | null;
  source: string | null;
  tags: string[];
  ownerMemberId: string | null;
  notes: string | null;
}

function CompanyForm({
  company,
  members,
  sources,
  canMerge,
  onClose,
}: {
  company?: CompanyFormValues;
  members: readonly MemberOption[];
  sources: readonly string[];
  canMerge: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  // Identifiant fixé avant l'envoi : renvoyer après une coupure retrouve la même fiche.
  const [requestId] = useState(() => crypto.randomUUID());
  const [allowSameName, setAllowSameName] = useState(false);

  const [state, action] = useActionState(
    async (previous: CrmActionState, formData: FormData): Promise<CrmActionState> => {
      const result = company
        ? await updateCompanyAction(company.id, previous, formData)
        : await createCompanyAction(previous, formData);
      if (result.status === "success") {
        toast({ message: result.message });
        onClose();
        if (!company && result.id) router.push(`/clients/${result.id}`);
      }
      return result;
    },
    IDLE_CRM_STATE,
  );

  const softDuplicate = state.duplicate?.soft;

  return (
    <form action={action} className="contents" noValidate>
      {company ? null : <input type="hidden" name="id" value={requestId} />}
      <ModalRow className="flex flex-col gap-4">
        <FormAlert state={state} />
        {state.duplicate ? (
          <DuplicateAlert duplicate={state.duplicate} onResolved={onClose} canMerge={canMerge} />
        ) : null}
        {softDuplicate ? (
          <Checkbox
            name="allowSameName"
            label="C'est bien un autre client, créer quand même"
            description="Domaine et SIREN restent uniques."
            checked={allowSameName}
            onChange={(event) => setAllowSameName(event.target.checked)}
          />
        ) : null}
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="name"
          label="Nom"
          required
          defaultValue={company?.name}
          fieldClassName="sm:col-span-2"
          data-autofocus
        />
        <TextField
          state={state}
          name="activity"
          label="Activité"
          placeholder="Fleuriste"
          defaultValue={company?.activity ?? ""}
        />
        <SelectField
          state={state}
          name="status"
          label="Statut"
          defaultValue={company?.status ?? "prospect"}
        >
          {COMPANY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {COMPANY_STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <TextField
          state={state}
          name="source"
          label="Origine"
          list="company-sources"
          defaultValue={company?.source ?? ""}
        />
        <datalist id="company-sources">
          {sources.map((source) => (
            <option key={source} value={source} />
          ))}
        </datalist>
        <SelectField
          state={state}
          name="ownerMemberId"
          label="Associé référent"
          defaultValue={company?.ownerMemberId ?? ""}
        >
          <option value="">Non attribué</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="domain"
          label="Site web"
          placeholder="atelier-lune.fr"
          inputMode="url"
          autoComplete="off"
          defaultValue={company?.domain ?? ""}
        />
        <TextField
          state={state}
          name="phone"
          label="Téléphone"
          inputMode="tel"
          hint="Format 06 12 34 56 78 ou +33612345678."
          defaultValue={company?.phone ?? ""}
        />
        <TextField
          state={state}
          name="addressLine"
          label="Adresse"
          defaultValue={company?.addressLine ?? ""}
          fieldClassName="sm:col-span-2"
        />
        <TextField
          state={state}
          name="postalCode"
          label="Code postal"
          defaultValue={company?.postalCode ?? ""}
        />
        <TextField state={state} name="city" label="Ville" defaultValue={company?.city ?? ""} />
        <TextField
          state={state}
          name="country"
          label="Pays"
          defaultValue={company?.country ?? ""}
        />
        <TextField
          state={state}
          name="siren"
          label="SIREN"
          inputMode="numeric"
          defaultValue={company?.siren ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-col gap-4">
        <TextField
          state={state}
          name="tags"
          label="Étiquettes"
          hint="Séparées par des virgules."
          defaultValue={company?.tags.join(", ") ?? ""}
        />
        <TextareaField
          state={state}
          name="notes"
          label="Notes internes"
          rows={3}
          hint="Besoins, objections, préférences : ce qu'il faut savoir avant d'appeler."
          defaultValue={company?.notes ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <SubmitButton>{company ? "Enregistrer" : "Créer le client"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

export function CompanyFormModal({
  open,
  onClose,
  company,
  members,
  sources,
  canMerge,
}: {
  open: boolean;
  onClose: () => void;
  company?: CompanyFormValues;
  members: readonly MemberOption[];
  sources: readonly string[];
  canMerge: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={company ? `Modifier ${company.name}` : "Nouveau client"}
      width={680}
    >
      <CompanyForm
        company={company}
        members={members}
        sources={sources}
        canMerge={canMerge}
        onClose={onClose}
      />
    </Modal>
  );
}

/** « + Nouveau client », action principale de l'écran 07. */
export function CompanyCreateButton({
  members,
  sources,
  canMerge,
}: {
  members: readonly MemberOption[];
  sources: readonly string[];
  canMerge: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
        Nouveau client
      </Button>
      <CompanyFormModal
        open={open}
        onClose={() => setOpen(false)}
        members={members}
        sources={sources}
        canMerge={canMerge}
      />
    </>
  );
}

export function CompanyEditButton({
  company,
  members,
  sources,
  canMerge,
}: {
  company: CompanyFormValues;
  members: readonly MemberOption[];
  sources: readonly string[];
  canMerge: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Modifier</Button>
      <CompanyFormModal
        open={open}
        onClose={() => setOpen(false)}
        company={company}
        members={members}
        sources={sources}
        canMerge={canMerge}
      />
    </>
  );
}
