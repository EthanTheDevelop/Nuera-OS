"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Checkbox,
  DateField,
  FormAlert,
  SelectField,
  TextareaField,
  TextField,
} from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { submittedValue, type ActionState } from "@/lib/action-state";
import {
  BILLING_PERIOD_LABELS,
  BILLING_PERIODS,
  CONTRACT_KIND_LABELS,
  CONTRACT_KINDS,
} from "@/lib/domain-enums";
import { createContractAction, updateContractAction } from "../contract.actions";
import type { ContractDetail, MaintenancePlanRow, QuoteOption } from "../contract.types";
import { useModalForm } from "./use-modal-form";

/** Champs numériques qu'une formule préremplit : `null` les laisse vides. */
interface ContractDefaults {
  priceCents: number | null;
  period: string;
  includedMinutes: number | null;
  includedTickets: number | null;
  responseHours: number | null;
  resolutionHours: number | null;
  scope: string | null;
  exclusions: string | null;
}

function TermsFields({
  state,
  defaults,
  withPrice,
}: {
  state: ActionState;
  defaults: ContractDefaults;
  withPrice: boolean;
}) {
  return (
    <>
      {withPrice ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            state={state}
            name="priceCents"
            label="Prix HT"
            defaultCents={defaults.priceCents}
            required
          />
          <SelectField
            state={state}
            name="period"
            label="Périodicité"
            defaultValue={defaults.period}
          >
            {BILLING_PERIODS.map((period) => (
              <option key={period} value={period}>
                {BILLING_PERIOD_LABELS[period]}
              </option>
            ))}
          </SelectField>
        </div>
      ) : (
        <input type="hidden" name="period" value={defaults.period} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <DurationField
          state={state}
          name="includedMinutes"
          label="Temps inclus par période"
          hint="Vide : pas de quota. 0 : aucun temps inclus."
          defaultMinutes={defaults.includedMinutes}
        />
        <TextField
          state={state}
          name="includedTickets"
          label="Demandes incluses par période"
          type="number"
          min={0}
          defaultValue={defaults.includedTickets ?? ""}
        />
        <TextField
          state={state}
          name="responseHours"
          label="Délai de réponse (heures)"
          type="number"
          min={0}
          defaultValue={defaults.responseHours ?? ""}
        />
        <TextField
          state={state}
          name="resolutionHours"
          label="Délai de résolution (heures)"
          type="number"
          min={0}
          defaultValue={defaults.resolutionHours ?? ""}
        />
      </div>
      <TextareaField
        state={state}
        name="scope"
        label="Inclus"
        rows={3}
        defaultValue={defaults.scope ?? ""}
      />
      <TextareaField
        state={state}
        name="exclusions"
        label="Exclusions"
        rows={3}
        defaultValue={defaults.exclusions ?? ""}
      />
    </>
  );
}

function CommonFields({
  state,
  name,
  kind,
  startOn,
  endOn,
  renewsOn,
  autoRenew,
  conditions,
  monthlyCostCents,
  canReadCosts,
}: {
  state: ActionState;
  name?: string;
  kind?: string;
  startOn?: string | null;
  endOn?: string | null;
  renewsOn?: string | null;
  autoRenew?: boolean;
  conditions?: string | null;
  monthlyCostCents?: number | null;
  canReadCosts: boolean;
}) {
  const returnedAuto = submittedValue(state, "autoRenew");
  return {
    identity: (
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField state={state} name="name" label="Nom du contrat" defaultValue={name} required />
        <SelectField state={state} name="kind" label="Type" defaultValue={kind ?? "maintenance"}>
          {CONTRACT_KINDS.map((value) => (
            <option key={value} value={value}>
              {CONTRACT_KIND_LABELS[value]}
            </option>
          ))}
        </SelectField>
      </div>
    ),
    dates: (
      <>
        <div className="grid gap-4 sm:grid-cols-3">
          <DateField state={state} name="startOn" label="Début" defaultValue={startOn ?? ""} />
          <DateField state={state} name="endOn" label="Fin" defaultValue={endOn ?? ""} />
          <DateField
            state={state}
            name="renewsOn"
            label="Renouvellement"
            defaultValue={renewsOn ?? ""}
          />
        </div>
        <Checkbox
          name="autoRenew"
          label="Renouvellement automatique"
          description="À chaque échéance, le contrat repart pour une période."
          defaultChecked={returnedAuto !== undefined ? returnedAuto === "on" : autoRenew}
        />
      </>
    ),
    closing: (
      <>
        <TextareaField
          state={state}
          name="conditions"
          label="Conditions"
          rows={3}
          defaultValue={conditions ?? ""}
        />
        {canReadCosts ? (
          <MoneyField
            state={state}
            name="monthlyCostCents"
            label="Coût mensuel HT"
            hint="Visible des associés uniquement."
            defaultCents={monthlyCostCents ?? null}
          />
        ) : null}
      </>
    ),
  };
}

/** Le devis accepté dont vient le contrat : le lien vers ses prestations (08.01.01). */
function QuoteField({
  state,
  quotes,
  defaultValue,
}: {
  state: ActionState;
  quotes: readonly QuoteOption[];
  defaultValue: string;
}) {
  if (quotes.length === 0) return <input type="hidden" name="quoteId" value={defaultValue} />;
  return (
    <SelectField state={state} name="quoteId" label="Devis d'origine" defaultValue={defaultValue}>
      <option value="">Aucun devis</option>
      {quotes.map((quote) => (
        <option key={quote.id} value={quote.id}>
          {quote.title ? `${quote.number} · ${quote.title}` : quote.number}
        </option>
      ))}
    </SelectField>
  );
}

function NewContractForm({
  companies,
  plans,
  quotes,
  canReadCosts,
  defaultCompanyId,
  defaultQuoteId,
  onDone,
}: {
  companies: readonly { id: string; name: string }[];
  plans: readonly MaintenancePlanRow[];
  quotes: readonly QuoteOption[];
  canReadCosts: boolean;
  defaultCompanyId?: string;
  defaultQuoteId?: string;
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(createContractAction, onDone);
  const [planId, setPlanId] = useState(submittedValue(state, "planId") ?? "");
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const companyQuotes = quotes.filter((quote) => quote.companyId === companyId);
  const plan = plans.find((row) => row.id === planId);
  const common = CommonFields({ state, canReadCosts });

  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            state={state}
            name="companyId"
            label="Client"
            defaultValue={defaultCompanyId ?? ""}
            onChange={(event) => setCompanyId(event.target.value)}
            required
            data-autofocus
          >
            <option value="" disabled>
              Choisir un client
            </option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            state={state}
            name="planId"
            label="Formule"
            hint="Préremplit le prix, les quotas et le périmètre."
            defaultValue={planId}
            onChange={(event) => setPlanId(event.target.value)}
          >
            <option value="">Sans formule</option>
            {plans.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </SelectField>
        </div>
        {common.identity}
        {/* Les devis proposés sont ceux du client choisi : les changer remonte le champ. */}
        <QuoteField
          key={`devis-${companyId}`}
          state={state}
          quotes={companyQuotes}
          defaultValue={
            companyQuotes.some((quote) => quote.id === defaultQuoteId) ? (defaultQuoteId ?? "") : ""
          }
        />
        {/* Changer de formule remonte ces champs avec les valeurs de la formule. */}
        <TermsFields
          key={`formule-${planId}`}
          state={state}
          withPrice
          defaults={{
            priceCents: plan?.priceCents ?? null,
            period: plan?.period ?? "monthly",
            includedMinutes: plan?.includedMinutes ?? null,
            includedTickets: plan?.includedTickets ?? null,
            responseHours: plan?.responseHours ?? null,
            resolutionHours: plan?.resolutionHours ?? null,
            scope: plan?.scope ?? null,
            exclusions: plan?.exclusions ?? null,
          }}
        />
        {common.dates}
        {common.closing}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Créer le contrat</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

/** « + Nouveau contrat » : `defaultOpen` et `defaultCompanyId` servent aux liens depuis une fiche. */
export function NewContractButton({
  companies,
  plans,
  quotes,
  canReadCosts,
  defaultOpen = false,
  defaultCompanyId,
  defaultQuoteId,
}: {
  companies: readonly { id: string; name: string }[];
  plans: readonly MaintenancePlanRow[];
  quotes: readonly QuoteOption[];
  canReadCosts: boolean;
  defaultOpen?: boolean;
  defaultCompanyId?: string;
  defaultQuoteId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        + Nouveau contrat
      </Button>
      <Modal open={open} onClose={close} title="Nouveau contrat" icon="contrat" width={720}>
        <NewContractForm
          companies={companies}
          plans={plans}
          quotes={quotes}
          canReadCosts={canReadCosts}
          defaultCompanyId={defaultCompanyId}
          defaultQuoteId={defaultQuoteId}
          onDone={close}
        />
      </Modal>
    </>
  );
}

function EditContractForm({
  contract,
  plans,
  quotes,
  canReadCosts,
  onDone,
}: {
  contract: ContractDetail;
  plans: readonly MaintenancePlanRow[];
  quotes: readonly QuoteOption[];
  canReadCosts: boolean;
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(updateContractAction.bind(null, contract.id), onDone);
  const common = CommonFields({
    state,
    canReadCosts,
    name: contract.name,
    kind: contract.kind,
    startOn: contract.startOn,
    endOn: contract.endOn,
    renewsOn: contract.renewsOn,
    autoRenew: contract.autoRenew,
    conditions: contract.conditions,
    monthlyCostCents: contract.monthlyCostCents,
  });
  // Une formule retirée reste affichée pour le contrat qui la porte.
  const options = plans.filter((plan) => plan.active || plan.id === contract.planId);

  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        {common.identity}
        <QuoteField state={state} quotes={quotes} defaultValue={contract.quoteId ?? ""} />
        <SelectField
          state={state}
          name="planId"
          label="Formule"
          hint="Le prix se change par « Réviser le tarif », pour garder l'historique."
          defaultValue={contract.planId ?? ""}
        >
          <option value="">Sans formule</option>
          {options.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </SelectField>
        <TermsFields
          state={state}
          withPrice={false}
          defaults={{
            priceCents: contract.priceCents,
            period: contract.period,
            includedMinutes: contract.includedMinutes,
            includedTickets: contract.includedTickets,
            responseHours: contract.responseHours,
            resolutionHours: contract.resolutionHours,
            scope: contract.scope,
            exclusions: contract.exclusions,
          }}
        />
        {common.dates}
        {common.closing}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Enregistrer</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function EditContractButton({
  contract,
  plans,
  quotes,
  canReadCosts,
}: {
  contract: ContractDetail;
  plans: readonly MaintenancePlanRow[];
  quotes: readonly QuoteOption[];
  canReadCosts: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button icon="edit" onClick={() => setOpen(true)}>
        Modifier
      </Button>
      <Modal open={open} onClose={close} title="Modifier le contrat" icon="contrat" width={720}>
        <EditContractForm
          contract={contract}
          plans={plans}
          quotes={quotes}
          canReadCosts={canReadCosts}
          onDone={close}
        />
      </Modal>
    </>
  );
}
