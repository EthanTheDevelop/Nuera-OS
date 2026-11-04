"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateField, FormAlert, SelectField, TextField } from "@/components/ui/form";
import { MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  BILLING_PERIOD_LABELS,
  BILLING_PERIODS,
  COST_CATEGORIES,
  COST_CATEGORY_LABELS,
  COST_NATURE_LABELS,
  COST_NATURES,
} from "@/lib/domain-enums";
import { createDirectCostAction, updateDirectCostAction } from "../finance.actions";
import type { DirectCostRow, FinanceFormOptions } from "../finance.service";
import { useCompanyLinks, withCurrent } from "./use-company-links";

function CostForm({
  options,
  cost,
  onDone,
  onCancel,
}: {
  options: FinanceFormOptions;
  cost?: DirectCostRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(
    cost ? updateDirectCostAction.bind(null, cost.id) : createDirectCostAction,
    IDLE_ACTION_STATE,
  );
  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const [companyId, setCompanyId] = useState(
    (state.status === "error" ? state.values?.companyId : undefined) ?? cost?.companyId ?? "",
  );
  const { links, loading } = useCompanyLinks(companyId);
  const saved = cost?.companyId === companyId ? cost : null;

  return (
    <form action={action} className="contents">
      <FormAlert state={state} />
      <ModalRow className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="label"
          label="Libellé"
          placeholder="Licence, sous-traitance…"
          defaultValue={cost?.label ?? ""}
          fieldClassName="sm:col-span-2"
          required
          data-autofocus
        />
        <SelectField
          state={state}
          name="category"
          label="Catégorie"
          defaultValue={cost?.category ?? "other"}
        >
          {COST_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {COST_CATEGORY_LABELS[category]}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="nature"
          label="Nature"
          hint="Le prévisionnel et le réalisé ne s'additionnent jamais."
          defaultValue={cost?.nature ?? "actual"}
        >
          {COST_NATURES.map((nature) => (
            <option key={nature} value={nature}>
              {COST_NATURE_LABELS[nature]}
            </option>
          ))}
        </SelectField>
        <MoneyField
          state={state}
          name="amountCents"
          label="Montant HT"
          hint="Par période pour un coût récurrent. Vide ou 0 : récurrent à chiffrer."
          defaultCents={cost?.amountCents ?? null}
        />
        <DateField
          state={state}
          name="incurredOn"
          label="Date"
          hint="Première échéance pour un coût récurrent."
          defaultValue={cost?.incurredOn ?? ""}
          required
        />
        <SelectField
          state={state}
          name="recurringPeriod"
          label="Récurrence"
          defaultValue={cost?.recurringPeriod ?? ""}
        >
          <option value="">Ponctuel</option>
          {BILLING_PERIODS.map((period) => (
            <option key={period} value={period}>
              {BILLING_PERIOD_LABELS[period]}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="memberId"
          label="Intervenant"
          defaultValue={cost?.memberId ?? ""}
        >
          <option value="">Aucun</option>
          {withCurrent(
            options.members.map((member) => ({ id: member.id, label: member.fullName })),
            cost ? { id: cost.memberId, label: cost.memberName } : null,
          ).map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="companyId"
          label="Client"
          hint="Vide : frais généraux de l'agence."
          defaultValue={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
          fieldClassName="sm:col-span-2"
        >
          <option value="">Aucun</option>
          {withCurrent(
            options.companies.map((company) => ({ id: company.id, label: company.name })),
            cost ? { id: cost.companyId, label: cost.companyName } : null,
          ).map((company) => (
            <option key={company.id} value={company.id}>
              {company.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`project-${companyId}-${loading}`}
          state={state}
          name="projectId"
          label="Projet"
          defaultValue={cost?.projectId ?? ""}
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
          defaultValue={cost?.contractId ?? ""}
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
          key={`site-${companyId}-${loading}`}
          state={state}
          name="siteId"
          label="Site"
          defaultValue={cost?.siteId ?? ""}
          disabled={!companyId || loading}
          fieldClassName="sm:col-span-2"
        >
          <option value="">Aucun</option>
          {withCurrent(links.sites, saved && { id: saved.siteId, label: saved.siteName }).map(
            (site) => (
              <option key={site.id} value={site.id}>
                {site.label}
              </option>
            ),
          )}
        </SelectField>
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel}>Annuler</Button>
        <SubmitButton>{cost ? "Enregistrer" : "Ajouter le coût"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

export function CostFormModal({
  open,
  onClose,
  options,
  cost,
}: {
  open: boolean;
  onClose: () => void;
  options: FinanceFormOptions;
  cost?: DirectCostRow;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="wallet"
      title={cost ? "Modifier le coût" : "Nouveau coût"}
      width={560}
    >
      <CostForm options={options} cost={cost} onDone={onClose} onCancel={onClose} />
    </Modal>
  );
}
