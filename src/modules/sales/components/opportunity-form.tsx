"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { DateField, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { OPPORTUNITY_STAGE_LABELS, type OpportunityStage } from "@/lib/domain-enums";
import type { ContactOption } from "@/modules/crm/company.lookup";
import { CompanyPicker } from "@/modules/crm/components/company-picker";
import { DuplicateAlert } from "@/modules/crm/components/duplicate-alert";
import { IDLE_CRM_STATE, type CrmActionState } from "@/modules/crm/crm.action-state";
import { listContactOptionsAction } from "@/modules/crm/crm.actions";
import type { MemberOption } from "@/modules/team/team.lookup";
import { createOpportunityAction, updateOpportunityAction } from "../opportunity.actions";

const OPEN_STAGES: readonly OpportunityStage[] = ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"];

export interface OpportunityFormValues {
  id: string;
  name: string;
  stage: OpportunityStage;
  company: { id: string; name: string } | null;
  contactId: string | null;
  contactName: string | null;
  amountCents: number | null;
  expectedCloseOn: string | null;
  probability: number | null;
  source: string | null;
  need: string | null;
  budgetEstimateCents: number | null;
  ownerMemberId: string | null;
}

export interface OpportunityFormOptions {
  members: readonly MemberOption[];
  sources: readonly string[];
  canMerge: boolean;
}

function OpportunityForm({
  opportunity,
  defaults,
  options,
  onClose,
}: {
  opportunity?: OpportunityFormValues;
  defaults?: { stage?: OpportunityStage; company?: { id: string; name: string } | null };
  options: OpportunityFormOptions;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const initialCompany = opportunity?.company ?? defaults?.company ?? null;
  const [company, setCompany] = useState(initialCompany);
  const [newCompany, setNewCompany] = useState(false);
  const [contacts, setContacts] = useState<{
    companyId: string;
    options: readonly ContactOption[];
  } | null>(null);
  const [, startLoading] = useTransition();

  const companyId = company?.id ?? null;
  useEffect(() => {
    if (!companyId) return;
    startLoading(async () => {
      try {
        setContacts({ companyId, options: await listContactOptionsAction(companyId) });
      } catch {
        // Liste indisponible : le champ reste désactivé, le contact en place ne bouge pas.
      }
    });
  }, [companyId]);

  // Tant que la liste n'est pas là, le champ reste désactivé, donc absent de l'envoi : un contact
  // déjà rattaché reste en place. Il ne se monte qu'une fois ses options connues, sinon le
  // navigateur ne retient pas sa valeur initiale et l'envoi effacerait le contact.
  const contactOptions = contacts?.companyId === companyId ? contacts?.options : undefined;
  const keepsCompany = companyId !== null && companyId === opportunity?.company?.id;
  const currentContactId = keepsCompany ? (opportunity?.contactId ?? "") : "";
  // Contact archivé depuis : absent de la liste, mais toujours rattaché à l'affaire.
  const archivedContact =
    contactOptions && currentContactId && !contactOptions.some((c) => c.id === currentContactId)
      ? { id: currentContactId, name: opportunity?.contactName ?? "Contact" }
      : null;

  const [state, action] = useActionState(
    async (previous: CrmActionState, formData: FormData): Promise<CrmActionState> => {
      const result = opportunity
        ? await updateOpportunityAction(opportunity.id, previous, formData)
        : await createOpportunityAction(previous, formData);
      if (result.status === "success") {
        toast({ message: result.message });
        onClose();
        if (!opportunity && result.id) router.push(`/pipeline/${result.id}`);
      }
      return result;
    },
    IDLE_CRM_STATE,
  );

  return (
    <form action={action} className="contents" noValidate>
      {opportunity ? null : <input type="hidden" name="id" value={requestId} />}
      <ModalRow className="flex flex-col gap-4">
        <FormAlert state={state} />
        {state.duplicate ? (
          <DuplicateAlert
            duplicate={state.duplicate}
            onResolved={onClose}
            canMerge={options.canMerge}
          />
        ) : null}
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="name"
          label="Nom de l'affaire"
          required
          placeholder="Site vitrine"
          defaultValue={opportunity?.name}
          fieldClassName="sm:col-span-2"
          data-autofocus
        />
        <div className="flex flex-col gap-1">
          {newCompany ? (
            <TextField
              state={state}
              name="newCompanyName"
              label="Nouvelle société"
              hint="Sa fiche prospect sera créée avec l'affaire."
            />
          ) : (
            <CompanyPicker
              name="companyId"
              label="Client"
              initial={initialCompany}
              error={state.status === "error" ? state.fieldErrors?.companyId?.[0] : undefined}
              onChange={setCompany}
            />
          )}
          {opportunity ? null : (
            <CompactButton
              variant="quiet"
              className="self-start"
              onClick={() => {
                setNewCompany((current) => !current);
                setCompany(null);
              }}
            >
              {newCompany ? "Choisir un client existant" : "Société encore inconnue"}
            </CompactButton>
          )}
        </div>
        <SelectField
          key={`${companyId ?? "aucun"}:${contactOptions ? "prêt" : "attente"}`}
          state={state}
          name="contactId"
          label="Contact"
          disabled={!contactOptions}
          defaultValue={currentContactId}
          hint={companyId ? undefined : "Choisissez d'abord un client."}
        >
          <option value="">Aucun contact précis</option>
          {archivedContact ? (
            <option value={archivedContact.id}>{archivedContact.name} (archivé)</option>
          ) : null}
          {contactOptions?.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.fullName}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        {opportunity ? null : (
          <SelectField
            state={state}
            name="stage"
            label="Étape"
            defaultValue={defaults?.stage ?? "NEW"}
          >
            {OPEN_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {OPPORTUNITY_STAGE_LABELS[stage]}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField
          state={state}
          name="ownerMemberId"
          label="Responsable"
          defaultValue={opportunity?.ownerMemberId ?? ""}
        >
          <option value="">Non attribué</option>
          {options.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </SelectField>
        <MoneyField
          state={state}
          name="amountCents"
          label="Montant HT"
          defaultCents={opportunity?.amountCents ?? null}
        />
        <MoneyField
          state={state}
          name="budgetEstimateCents"
          label="Budget estimé HT"
          hint="Ce que le client a annoncé."
          defaultCents={opportunity?.budgetEstimateCents ?? null}
        />
        <TextField
          state={state}
          name="probability"
          label="Probabilité (%)"
          type="number"
          min={0}
          max={100}
          step={5}
          inputMode="numeric"
          defaultValue={opportunity?.probability ?? ""}
        />
        <DateField
          state={state}
          name="expectedCloseOn"
          label="Clôture prévue"
          defaultValue={opportunity?.expectedCloseOn ?? ""}
        />
        <TextField
          state={state}
          name="source"
          label="Origine"
          list="opportunity-sources"
          placeholder="Réseau, site, mini-audit…"
          defaultValue={opportunity?.source ?? ""}
          fieldClassName="sm:col-span-2"
        />
        <datalist id="opportunity-sources">
          {options.sources.map((source) => (
            <option key={source} value={source} />
          ))}
        </datalist>
      </ModalRow>
      <ModalRow>
        <TextareaField
          state={state}
          name="need"
          label="Besoin"
          rows={3}
          defaultValue={opportunity?.need ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <SubmitButton>{opportunity ? "Enregistrer" : "Créer l'affaire"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

/**
 * « + Nouvelle affaire ». `initialStage` ouvre la fenêtre à l'arrivée : c'est le « + Ajouter » d'une
 * colonne, un lien qui porte l'étape dans l'URL. La fermer retire ce paramètre.
 */
export function NewOpportunityButton({
  options,
  initialStage,
  closeHref,
  defaultCompany,
  compact = false,
}: {
  options: OpportunityFormOptions;
  initialStage?: OpportunityStage;
  closeHref?: string;
  defaultCompany?: { id: string; name: string };
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialStage !== undefined);
  const [syncedStage, setSyncedStage] = useState(initialStage);
  if (syncedStage !== initialStage) {
    setSyncedStage(initialStage);
    if (initialStage) setOpen(true);
  }
  const close = () => {
    setOpen(false);
    if (initialStage && closeHref) router.replace(closeHref, { scroll: false });
  };

  return (
    <>
      {compact ? (
        <CompactButton variant="quiet" icon="plus" onClick={() => setOpen(true)}>
          Nouvelle affaire
        </CompactButton>
      ) : (
        <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
          Nouvelle affaire
        </Button>
      )}
      <Modal open={open} onClose={close} title="Nouvelle affaire" width={640}>
        <OpportunityForm
          key={initialStage ?? "nouvelle"}
          defaults={{ stage: initialStage, company: defaultCompany }}
          options={options}
          onClose={close}
        />
      </Modal>
    </>
  );
}

export function EditOpportunityButton({
  opportunity,
  options,
}: {
  opportunity: OpportunityFormValues;
  options: OpportunityFormOptions;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Modifier</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Modifier ${opportunity.name}`}
        width={640}
      >
        <OpportunityForm
          opportunity={opportunity}
          options={options}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
