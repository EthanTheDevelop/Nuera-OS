"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_CHANNEL_LABELS,
  TICKET_COVERAGES,
  TICKET_COVERAGE_LABELS,
  TICKET_SEVERITIES,
  TICKET_SEVERITY_LABELS,
  type TicketCategory,
  type TicketCoverage,
  type TicketSeverity,
} from "@/lib/domain-enums";
import { Button } from "@/components/ui/button";
import {
  DateField,
  Field,
  FormAlert,
  Select,
  SelectField,
  TextareaField,
  TextField,
} from "@/components/ui/form";
import { SubmitButton, useSubmitKeepingValues } from "@/components/ui/form-client";
import { ModalRow } from "@/components/ui/modal";
import { fieldError, submittedValue } from "@/lib/action-state";
import {
  createTicketAction,
  loadCompanyTargetsAction,
  updateTicketAction,
  type CompanyTargetOptions,
  type TicketActionState,
} from "../ticket.actions";
import { STAFF_TICKET_CHANNELS } from "../ticket.schema";

const IDLE: TicketActionState = IDLE_ACTION_STATE;

interface MemberOption {
  id: string;
  fullName: string;
}

/**
 * Un contrat résilié ou un site archivé ne se propose plus, mais la demande qui y est rattachée le
 * garde : sans cette option, enregistrer la fiche effacerait le lien sans prévenir.
 */
function currentOption(
  id: string | null | undefined,
  label: string | null | undefined,
  options: readonly { id: string }[] | undefined,
) {
  if (!id || options?.some((option) => option.id === id)) return null;
  return <option value={id}>{label ?? "Rattachement actuel"}</option>;
}

function TargetFields({
  targets,
  state,
  defaults,
  disabled,
}: {
  targets: CompanyTargetOptions | null;
  state: TicketActionState;
  defaults?: {
    siteId: string | null;
    siteLabel: string | null;
    contractId: string | null;
    contractLabel: string | null;
    projectId: string | null;
    projectLabel: string | null;
  };
  disabled: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <SelectField
        name="siteId"
        label="Site"
        state={state}
        disabled={disabled}
        defaultValue={defaults?.siteId ?? ""}
      >
        <option value="">Aucun</option>
        {currentOption(defaults?.siteId, defaults?.siteLabel, targets?.sites)}
        {targets?.sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.domain ?? site.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        name="contractId"
        label="Contrat"
        hint="À défaut, celui du site."
        state={state}
        disabled={disabled}
        defaultValue={defaults?.contractId ?? ""}
      >
        <option value="">Aucun</option>
        {currentOption(defaults?.contractId, defaults?.contractLabel, targets?.contracts)}
        {targets?.contracts.map((contract) => (
          <option key={contract.id} value={contract.id}>
            {contract.number} · {contract.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        name="projectId"
        label="Projet"
        state={state}
        disabled={disabled}
        defaultValue={defaults?.projectId ?? ""}
      >
        <option value="">Aucun</option>
        {currentOption(defaults?.projectId, defaults?.projectLabel, targets?.projects)}
        {targets?.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.number} · {project.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function ClassificationFields({
  state,
  category,
  severity,
}: {
  state: TicketActionState;
  category?: TicketCategory;
  severity?: TicketSeverity;
}) {
  return (
    <>
      <SelectField
        name="category"
        label="Catégorie"
        state={state}
        defaultValue={category ?? "assistance"}
      >
        {TICKET_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {TICKET_CATEGORY_LABELS[value]}
          </option>
        ))}
      </SelectField>
      <SelectField
        name="severity"
        label="Gravité"
        state={state}
        defaultValue={severity ?? "medium"}
      >
        {TICKET_SEVERITIES.map((value) => (
          <option key={value} value={value}>
            {TICKET_SEVERITY_LABELS[value]}
          </option>
        ))}
      </SelectField>
    </>
  );
}

/** Nouvelle demande (non dessinée : mêmes champs que M4, dans la même fenêtre). */
export function CreateTicketForm({
  companies,
  members,
  onCreated,
  onCancel,
}: {
  companies: readonly { id: string; name: string }[];
  members: readonly MemberOption[];
  onCreated: (ticketId: string) => void;
  onCancel: () => void;
}) {
  const [state, action, submitting] = useActionState(
    async (previous: TicketActionState, formData: FormData) => {
      const next = await createTicketAction(previous, formData);
      if (next.status === "success" && next.ticketId) onCreated(next.ticketId);
      return next;
    },
    IDLE,
  );
  const submit = useSubmitKeepingValues(action, submitting);
  const [companyId, setCompanyId] = useState(submittedValue(state, "companyId") ?? "");
  const [targets, setTargets] = useState<CompanyTargetOptions | null>(null);
  const [loading, startLoading] = useTransition();
  const requested = useRef<string | null>(null);

  function selectCompany(next: string) {
    setCompanyId(next);
    setTargets(null);
    requested.current = next;
    if (!next) return;
    startLoading(async () => {
      const result = await loadCompanyTargetsAction(next);
      // Une réponse tardive pour un autre client est ignorée.
      if (requested.current === next) setTargets(result);
    });
  }

  const companyError = fieldError(state, "companyId");

  return (
    <form onSubmit={submit} className="contents">
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="flex flex-col gap-4">
        <Field id="ticket-company" label="Client" error={companyError}>
          <Select
            id="ticket-company"
            name="companyId"
            value={companyId}
            onChange={(event) => selectCompany(event.target.value)}
            aria-invalid={companyError ? true : undefined}
            data-autofocus
          >
            <option value="">Choisir un client</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
        <TextField
          name="subject"
          label="Objet"
          state={state}
          maxLength={200}
          placeholder="Ce que demande le client"
          required
        />
        <TextareaField name="description" label="Description" state={state} rows={4} />
      </ModalRow>
      <ModalRow>
        <TargetFields targets={targets} state={state} disabled={!targets || loading} />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <SelectField name="channel" label="Canal" state={state} defaultValue="email">
          {STAFF_TICKET_CHANNELS.map((value) => (
            <option key={value} value={value}>
              {TICKET_CHANNEL_LABELS[value]}
            </option>
          ))}
        </SelectField>
        <ClassificationFields state={state} />
        <SelectField name="assigneeMemberId" label="Responsable" state={state} defaultValue="">
          <option value="">Plus tard</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel}>Annuler</Button>
        <Button type="submit" variant="accent" loading={submitting}>
          Créer la demande
        </Button>
      </ModalRow>
    </form>
  );
}

/** Modifier une demande, dans sa fenêtre. Le client ne change pas : les rattachements en dépendent. */
export function EditTicketForm({
  ticket,
  targets,
  onDone,
}: {
  ticket: {
    id: string;
    subject: string;
    description: string | null;
    siteId: string | null;
    siteLabel: string | null;
    contractId: string | null;
    contractLabel: string | null;
    projectId: string | null;
    projectLabel: string | null;
    category: TicketCategory;
    severity: TicketSeverity;
    coverage: TicketCoverage;
    dueOn: string | null;
    contractualDue: boolean;
  };
  targets: CompanyTargetOptions | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState(
    async (previous: TicketActionState, formData: FormData) => {
      const next = await updateTicketAction(previous, formData);
      if (next.status === "success") onDone();
      return next;
    },
    IDLE,
  );

  return (
    <form action={action} className="contents">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="flex flex-col gap-4">
        <TextField
          name="subject"
          label="Objet"
          state={state}
          defaultValue={ticket.subject}
          maxLength={200}
          required
          data-autofocus
        />
        <TextareaField
          name="description"
          label="Description"
          state={state}
          defaultValue={ticket.description ?? ""}
          rows={4}
        />
      </ModalRow>
      <ModalRow>
        <TargetFields targets={targets} state={state} disabled={!targets} defaults={ticket} />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        <ClassificationFields state={state} category={ticket.category} severity={ticket.severity} />
        <SelectField
          name="coverage"
          label="Couverture"
          state={state}
          defaultValue={ticket.coverage}
        >
          {TICKET_COVERAGES.map((value) => (
            <option key={value} value={value}>
              {TICKET_COVERAGE_LABELS[value]}
            </option>
          ))}
        </SelectField>
        {ticket.contractualDue ? (
          <Field id="dueOn" label="Échéance" hint="Fixée par les délais du contrat.">
            <input
              id="dueOn"
              disabled
              value={ticket.dueOn ?? "—"}
              className="h-11 w-full rounded-md border border-border bg-surface-raised px-4 text-field text-muted"
            />
          </Field>
        ) : (
          <DateField
            name="dueOn"
            label="Échéance convenue"
            state={state}
            defaultValue={ticket.dueOn ?? ""}
          />
        )}
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Enregistrer</SubmitButton>
      </ModalRow>
    </form>
  );
}
