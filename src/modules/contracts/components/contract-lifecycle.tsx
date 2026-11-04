"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DateInput,
  Field,
  FormAlert,
  SelectField,
  Textarea,
  TextareaField,
} from "@/components/ui/form";
import { MoneyField, SubmitButton } from "@/components/ui/form-client";
import { DateField } from "@/components/ui/form";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { BILLING_PERIOD_LABELS, BILLING_PERIODS, type ContractStatus } from "@/lib/domain-enums";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import {
  archiveContractAction,
  changeContractPriceAction,
  changeContractStatusAction,
  renewContractAction,
  terminateContractAction,
} from "../contract.actions";
import { addBillingPeriod } from "../contract.rules";
import { canContractTransition } from "../contract.status";
import type { ContractDetail, TerminationImpact } from "../contract.types";
import { useModalForm } from "./use-modal-form";

/** Un bouton d'en-tête (accent) ou de carte (compact), selon l'endroit où il est posé. */
function Trigger({
  look,
  onClick,
  children,
}: {
  look: "header" | "card";
  onClick: () => void;
  children: ReactNode;
}) {
  return look === "header" ? (
    <Button variant="accent" onClick={onClick}>
      {children}
    </Button>
  ) : (
    <CompactButton variant="secondary" onClick={onClick}>
      {children}
    </CompactButton>
  );
}

function StatusForm({
  contractId,
  status,
  confirmLabel,
  description,
  noteLabel,
  onDone,
}: {
  contractId: string;
  status: "active" | "to_review" | "suspended" | "expired";
  confirmLabel: string;
  description: string;
  noteLabel: string;
  onDone: () => void;
}) {
  const { state, formAction } = useModalForm(
    changeContractStatusAction.bind(null, contractId),
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{description}</p>
        <FormAlert state={state} />
        <input type="hidden" name="status" value={status} />
        <TextareaField state={state} name="note" label={noteLabel} rows={3} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>{confirmLabel}</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function StatusButton({
  contractId,
  status,
  label,
  title,
  description,
  noteLabel = "Note (facultative)",
  look = "card",
}: {
  contractId: string;
  status: "active" | "to_review" | "suspended" | "expired";
  label: string;
  title: string;
  description: string;
  noteLabel?: string;
  look?: "header" | "card";
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Trigger look={look} onClick={() => setOpen(true)}>
        {label}
      </Trigger>
      <Modal open={open} onClose={close} title={title} icon="contrat" width={480}>
        <StatusForm
          contractId={contractId}
          status={status}
          confirmLabel={label}
          description={description}
          noteLabel={noteLabel}
          onDone={close}
        />
      </Modal>
    </>
  );
}

function RenewForm({ contract, onDone }: { contract: ContractDetail; onDone: () => void }) {
  const { state, formAction } = useModalForm(renewContractAction.bind(null, contract.id), onDone);
  const current = contract.nextDueOn;
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Échéance actuelle : {formatDate(current)}. Le renouvellement est inscrit à
          l&apos;historique.
        </p>
        <FormAlert state={state} />
        <input type="hidden" name="expectedNextOn" value={current ?? ""} />
        <DateField
          state={state}
          name="newRenewsOn"
          label="Nouvelle échéance"
          hint="Par défaut, une période de plus."
          defaultValue={current ? addBillingPeriod(current, contract.period) : ""}
        />
        <TextareaField state={state} name="note" label="Note (facultative)" rows={3} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Renouveler</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function RenewButton({
  contract,
  look = "card",
}: {
  contract: ContractDetail;
  look?: "header" | "card";
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Trigger look={look} onClick={() => setOpen(true)}>
        Renouveler
      </Trigger>
      <Modal open={open} onClose={close} title="Renouveler le contrat" icon="calendar" width={480}>
        <RenewForm contract={contract} onDone={close} />
      </Modal>
    </>
  );
}

function PriceForm({ contract, onDone }: { contract: ContractDetail; onDone: () => void }) {
  const { state, formAction } = useModalForm(
    changeContractPriceAction.bind(null, contract.id),
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Tarif actuel : {formatCents(contract.priceCents)}. L&apos;ancien prix reste dans
          l&apos;historique et dans les revenus passés.
        </p>
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            state={state}
            name="priceCents"
            label="Nouveau prix HT"
            defaultCents={contract.priceCents}
            required
          />
          <SelectField
            state={state}
            name="period"
            label="Périodicité"
            defaultValue={contract.period}
          >
            {BILLING_PERIODS.map((period) => (
              <option key={period} value={period}>
                {BILLING_PERIOD_LABELS[period]}
              </option>
            ))}
          </SelectField>
        </div>
        <TextareaField state={state} name="note" label="Motif (facultatif)" rows={3} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>Réviser le tarif</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function PriceButton({ contract }: { contract: ContractDetail }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Trigger look="card" onClick={() => setOpen(true)}>
        Réviser le tarif
      </Trigger>
      <Modal open={open} onClose={close} title="Réviser le tarif" icon="euro" width={480}>
        <PriceForm contract={contract} onDone={close} />
      </Modal>
    </>
  );
}

/** Ce qu'il reste à arrêter : rien n'est coupé automatiquement chez un service externe. */
export function StopList({ impact }: { impact: TerminationImpact }) {
  const items: ReactNode[] = [
    ...impact.sites.map((site) => (
      <>
        Site {site.primaryDomain ?? site.name}
        {site.hostingLabel ? ` · ${site.hostingLabel}` : ""}
        {site.serverLabel ? ` · ${site.serverLabel}` : ""}
      </>
    )),
    ...impact.domains.map((domain) => (
      <>
        Domaine {domain.name}
        {domain.expiresOn ? ` · expire le ${formatDate(domain.expiresOn)}` : ""}
        {domain.autoRenew ? " · renouvellement automatique à couper" : ""}
      </>
    )),
    ...(impact.recurringCosts ?? []).map((cost) => (
      <>
        Coût récurrent : {cost.label} · {formatCents(cost.amountCents)}
      </>
    )),
  ];
  if (impact.plannedInterventions > 0) {
    items.push(<>{impact.plannedInterventions} intervention(s) prévue(s), annulée(s) ici</>);
  }
  if (impact.openTickets > 0) {
    items.push(<>{impact.openTickets} demande(s) ouverte(s) à traiter</>);
  }
  if (impact.plannedScheduleItems) {
    items.push(<>{impact.plannedScheduleItems} échéance(s) de facturation prévue(s) à annuler</>);
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted">Aucun service rattaché à ce contrat.</p>;
  }
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-text">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function TerminateButton({
  contract,
  impact,
  today,
}: {
  contract: ContractDetail;
  impact: TerminationImpact;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [transfers, setTransfers] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [state, setState] = useState<ActionState>(IDLE_ACTION_STATE);
  const toast = useToast();

  async function confirm() {
    const result = await terminateContractAction(contract.id, {
      note,
      transfers,
      effectiveOn,
    });
    if (result.status === "success") {
      toast({ message: result.message, tone: "success" });
      setOpen(false);
      setState(IDLE_ACTION_STATE);
    } else {
      setState(result);
    }
  }

  return (
    <>
      <CompactButton variant="secondary" className="text-danger" onClick={() => setOpen(true)}>
        Résilier
      </CompactButton>
      <ConfirmDialog
        open={open}
        tone="danger"
        title={`Résilier le contrat ${contract.number}`}
        description="La résiliation est définitive et s'applique tout de suite. Rien n'est coupé automatiquement : arrêtez chaque service chez son fournisseur. Pour arrêter à l'échéance, indiquez plutôt une date de fin et coupez le renouvellement automatique."
        confirmLabel="Résilier le contrat"
        requireWord="RÉSILIER"
        onConfirm={confirm}
        onCancel={() => {
          setOpen(false);
          setState(IDLE_ACTION_STATE);
        }}
      >
        <div className="flex flex-col gap-4">
          <FormAlert state={state} />
          <div className="flex flex-col gap-2">
            <p className="text-field-label text-text">Services à arrêter</p>
            <StopList impact={impact} />
          </div>
          <Field
            id="termination-note"
            label="Motif"
            error={state.status === "error" ? state.fieldErrors?.note?.[0] : undefined}
          >
            <Textarea
              id="termination-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <Field
            id="termination-transfers"
            label="Transferts à prévoir (facultatif)"
            hint="Domaine, accès, sauvegardes : ce qui part chez le client ou son nouveau prestataire."
            error={state.status === "error" ? state.fieldErrors?.transfers?.[0] : undefined}
          >
            <Textarea
              id="termination-transfers"
              rows={2}
              value={transfers}
              onChange={(event) => setTransfers(event.target.value)}
            />
          </Field>
          <Field
            id="termination-date"
            label="Date d'effet"
            error={state.status === "error" ? state.fieldErrors?.effectiveOn?.[0] : undefined}
          >
            <DateInput
              id="termination-date"
              value={effectiveOn}
              max={today}
              onChange={(event) => setEffectiveOn(event.target.value)}
            />
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}

export function ArchiveButton({ contract }: { contract: ContractDetail }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  async function confirm() {
    // En cas de succès, l'action redirige vers la liste.
    const result = await archiveContractAction(contract.id);
    if (result.status === "error") {
      toast({ message: result.message, tone: "danger" });
      setOpen(false);
    }
  }

  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Archiver
      </CompactButton>
      <ConfirmDialog
        open={open}
        title={`Archiver le contrat ${contract.number}`}
        description="Il disparaît des listes. Son historique et le journal des actions restent conservés."
        confirmLabel="Archiver"
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/** Actions de la carte « Cycle de vie », selon la machine à états et les droits. */
export function ContractLifecycle({
  contract,
  impact,
  today,
  canUpdate,
  canTerminate,
}: {
  contract: ContractDetail;
  impact: TerminationImpact;
  today: string;
  canUpdate: boolean;
  canTerminate: boolean;
}) {
  const status: ContractStatus = contract.status;
  const inForce = status === "active" || status === "to_review";
  const ended = status === "terminated" || status === "expired";
  const pastEnd = contract.endOn !== null && contract.endOn <= today;
  const allows = (to: ContractStatus) => canContractTransition(status, to);

  return (
    <div className="flex flex-wrap gap-2">
      {canUpdate && inForce && contract.nextDueOn ? <RenewButton contract={contract} /> : null}
      {canUpdate && !ended ? <PriceButton contract={contract} /> : null}
      {canUpdate && allows("to_review") ? (
        <StatusButton
          contractId={contract.id}
          status="to_review"
          label="Marquer à revoir"
          title="Marquer à revoir"
          description="Le contrat reste en vigueur et facturé, le temps de réévaluer ses conditions."
          noteLabel="Ce qu'il faut revoir (facultatif)"
        />
      ) : null}
      {canUpdate && status === "to_review" ? (
        <StatusButton
          contractId={contract.id}
          status="active"
          label="Révision terminée"
          title="Terminer la révision"
          description="Le contrat redevient actif."
        />
      ) : null}
      {canUpdate && allows("suspended") ? (
        <StatusButton
          contractId={contract.id}
          status="suspended"
          label="Suspendre"
          title="Suspendre le contrat"
          description="Il sort des revenus récurrents et ne couvre plus aucune demande, jusqu'à sa reprise."
          noteLabel="Motif (facultatif)"
        />
      ) : null}
      {canUpdate && status === "active" && pastEnd ? (
        <StatusButton
          contractId={contract.id}
          status="expired"
          label="Constater l'expiration"
          title="Constater l'expiration"
          description="La date de fin est atteinte. Ce passage est définitif."
        />
      ) : null}
      {canTerminate && allows("terminated") ? (
        <TerminateButton contract={contract} impact={impact} today={today} />
      ) : null}
      {canTerminate && (ended || status === "to_start") ? (
        <ArchiveButton contract={contract} />
      ) : null}
    </div>
  );
}
