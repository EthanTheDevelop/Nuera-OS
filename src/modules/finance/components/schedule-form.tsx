"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateField, FormAlert, SelectField, TextField } from "@/components/ui/form";
import { MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { createScheduleItemAction, updateScheduleItemAction } from "../finance.actions";
import type { FinanceFormOptions, ScheduleRow } from "../finance.service";
import { useCompanyLinks, withCurrent } from "./use-company-links";

function ScheduleForm({
  options,
  item,
  onDone,
  onCancel,
}: {
  options: FinanceFormOptions;
  item?: ScheduleRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(
    item ? updateScheduleItemAction.bind(null, item.id) : createScheduleItemAction,
    IDLE_ACTION_STATE,
  );
  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const [companyId, setCompanyId] = useState(
    (state.status === "error" ? state.values?.companyId : undefined) ?? item?.companyId ?? "",
  );
  const { links, loading } = useCompanyLinks(companyId);
  const saved = item?.companyId === companyId ? item : null;

  return (
    <form action={action} className="contents">
      <FormAlert state={state} />
      <ModalRow className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="label"
          label="Libellé"
          placeholder="Acompte 30 %"
          defaultValue={item?.label ?? ""}
          fieldClassName="sm:col-span-2"
          required
          data-autofocus
        />
        <SelectField
          state={state}
          name="companyId"
          label="Client"
          required
          defaultValue={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
          fieldClassName="sm:col-span-2"
        >
          <option value="">Choisir…</option>
          {withCurrent(
            options.companies.map((company) => ({ id: company.id, label: company.name })),
            item ? { id: item.companyId, label: item.companyName } : null,
          ).map((company) => (
            <option key={company.id} value={company.id}>
              {company.label}
            </option>
          ))}
        </SelectField>
        <DateField
          state={state}
          name="dueOn"
          label="Date prévue"
          defaultValue={item?.dueOn ?? ""}
        />
        <MoneyField
          state={state}
          name="amountCents"
          label="Montant HT"
          defaultCents={item?.amountCents ?? null}
          required
        />
        <SelectField
          key={`project-${companyId}-${loading}`}
          state={state}
          name="projectId"
          label="Projet"
          defaultValue={item?.projectId ?? ""}
          disabled={!companyId || loading}
        >
          <option value="">Aucun</option>
          {withCurrent(
            links.projects,
            saved && { id: saved.projectId, label: saved.projectName },
          ).map((project) => (
            <option key={project.id} value={project.id}>
              {project.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`contract-${companyId}-${loading}`}
          state={state}
          name="contractId"
          label="Contrat"
          defaultValue={item?.contractId ?? ""}
          disabled={!companyId || loading}
        >
          <option value="">Aucun</option>
          {withCurrent(
            links.contracts,
            saved && { id: saved.contractId, label: saved.contractName },
          ).map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`quote-${companyId}-${loading}`}
          state={state}
          name="quoteId"
          label="Devis"
          defaultValue={item?.quoteId ?? ""}
          disabled={!companyId || loading}
          fieldClassName="sm:col-span-2"
        >
          <option value="">Aucun</option>
          {withCurrent(links.quotes, saved && { id: saved.quoteId, label: null }).map((quote) => (
            <option key={quote.id} value={quote.id}>
              {quote.label}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel}>Annuler</Button>
        <SubmitButton>{item ? "Enregistrer" : "Ajouter l'échéance"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

export function ScheduleFormModal({
  open,
  onClose,
  options,
  item,
}: {
  open: boolean;
  onClose: () => void;
  options: FinanceFormOptions;
  item?: ScheduleRow;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="clock"
      title={item ? "Modifier l'échéance" : "Nouvelle échéance"}
      description="Un paiement prévu. Ses factures s'y rattachent ensuite, une par associé émetteur en co-traitance."
      width={560}
    >
      <ScheduleForm options={options} item={item} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}
