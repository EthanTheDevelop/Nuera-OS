"use client";

import { useActionState, useEffect, useState } from "react";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox, DateField, FormAlert, SelectField, TextField } from "@/components/ui/form";
import { MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { FINANCIAL_DOCUMENT_KIND_LABELS, FINANCIAL_DOCUMENT_KINDS } from "@/lib/domain-enums";
import { NO_LEGAL_VALUE_NOTICE } from "../finance.constants";
import { createInvoiceAction, updateInvoiceAction } from "../finance.actions";
import type { FinanceFormOptions, InvoiceRow } from "../finance.service";
import { useCompanyLinks, withCurrent } from "./use-company-links";

export interface InvoiceFormDefaults {
  companyId?: string;
  projectId?: string | null;
  contractId?: string | null;
  quoteId?: string | null;
  scheduleItemId?: string | null;
  amountCents?: number;
}

function InvoiceForm({
  options,
  invoice,
  defaults,
  onDone,
  onCancel,
}: {
  options: FinanceFormOptions;
  invoice?: InvoiceRow;
  defaults?: InvoiceFormDefaults;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(
    invoice ? updateInvoiceAction.bind(null, invoice.id) : createInvoiceAction,
    IDLE_ACTION_STATE,
  );
  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);

  const initialCompany =
    (state.status === "error" ? state.values?.companyId : undefined) ??
    invoice?.companyId ??
    defaults?.companyId ??
    "";
  const [companyId, setCompanyId] = useState(initialCompany);
  const { links, loading } = useCompanyLinks(companyId);
  /** Les liens enregistrés ne valent que pour le client de la facture. */
  const saved = invoice?.companyId === companyId ? invoice : null;

  return (
    <form action={action} className="contents">
      <ModalRow>
        <Alert tone="warn">{NO_LEGAL_VALUE_NOTICE}</Alert>
      </ModalRow>
      <FormAlert state={state} />
      <ModalRow className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="externalRef"
          label="Référence dans Indy"
          defaultValue={invoice?.externalRef ?? ""}
          autoComplete="off"
          required
          data-autofocus
        />
        <SelectField
          state={state}
          name="kind"
          label="Type"
          defaultValue={invoice?.kind ?? "invoice"}
        >
          {FINANCIAL_DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {FINANCIAL_DOCUMENT_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="companyId"
          label="Client"
          required
          defaultValue={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
        >
          <option value="">Choisir…</option>
          {withCurrent(
            options.companies.map((company) => ({ id: company.id, label: company.name })),
            invoice ? { id: invoice.companyId, label: invoice.companyName } : null,
          ).map((company) => (
            <option key={company.id} value={company.id}>
              {company.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="issuerMemberId"
          label="Émise par"
          hint="En co-traitance, une facture par associé."
          defaultValue={invoice?.issuerMemberId ?? ""}
          required
        >
          <option value="">Choisir…</option>
          {withCurrent(
            options.issuers.map((issuer) => ({ id: issuer.id, label: issuer.fullName })),
            invoice ? { id: invoice.issuerMemberId, label: invoice.issuerName } : null,
          ).map((issuer) => (
            <option key={issuer.id} value={issuer.id}>
              {issuer.label}
            </option>
          ))}
        </SelectField>
        <DateField
          state={state}
          name="issuedOn"
          label="Émise le"
          defaultValue={invoice?.issuedOn ?? ""}
          required
        />
        <DateField
          state={state}
          name="dueOn"
          label="Échéance"
          defaultValue={invoice?.dueOn ?? ""}
        />
        <MoneyField
          state={state}
          name="amountCents"
          label="Montant HT"
          defaultCents={invoice ? Math.abs(invoice.amountCents) : (defaults?.amountCents ?? null)}
          required
        />
        <MoneyField
          state={state}
          name="taxCents"
          label="TVA"
          defaultCents={invoice ? Math.abs(invoice.taxCents) : null}
        />
        {/* `key` : recrée la liste quand le client change, pour reprendre la valeur initiale. */}
        <SelectField
          key={`schedule-${companyId}-${loading}`}
          state={state}
          name="scheduleItemId"
          label="Échéance liée"
          defaultValue={invoice?.scheduleItemId ?? defaults?.scheduleItemId ?? ""}
          disabled={!companyId || loading}
        >
          <option value="">Aucune</option>
          {withCurrent(
            links.scheduleItems,
            saved && { id: saved.scheduleItemId, label: saved.scheduleLabel },
          ).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`project-${companyId}-${loading}`}
          state={state}
          name="projectId"
          label="Projet"
          defaultValue={invoice?.projectId ?? defaults?.projectId ?? ""}
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
          defaultValue={invoice?.contractId ?? defaults?.contractId ?? ""}
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
          defaultValue={invoice?.quoteId ?? defaults?.quoteId ?? ""}
          disabled={!companyId || loading}
        >
          <option value="">Aucun</option>
          {withCurrent(links.quotes, saved && { id: saved.quoteId, label: saved.quoteNumber }).map(
            (quote) => (
              <option key={quote.id} value={quote.id}>
                {quote.label}
              </option>
            ),
          )}
        </SelectField>
        <SelectField
          key={`document-${companyId}-${loading}`}
          state={state}
          name="documentId"
          label="Justificatif"
          hint="Une facture déjà classée dans Documents."
          defaultValue={invoice?.documentId ?? ""}
          disabled={!companyId || loading}
          fieldClassName="sm:col-span-2"
        >
          <option value="">Aucun</option>
          {withCurrent(
            links.documents,
            saved && { id: saved.documentId, label: saved.documentTitle },
          ).map((document) => (
            <option key={document.id} value={document.id}>
              {document.label}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow>
        <Checkbox
          name="clientVisible"
          label="Visible dans l'espace client"
          description="Le client voit la référence, le montant et l'état, rien d'autre."
          defaultChecked={invoice?.clientVisible ?? false}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel}>Annuler</Button>
        <SubmitButton>{invoice ? "Enregistrer" : "Ajouter la référence"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** Saisie ou modification d'une référence de facture, dans une fenêtre. */
export function InvoiceFormModal({
  open,
  onClose,
  options,
  invoice,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  options: FinanceFormOptions;
  invoice?: InvoiceRow;
  defaults?: InvoiceFormDefaults;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="euro"
      title={invoice ? "Modifier la référence" : "Nouvelle référence de facture"}
      width={640}
    >
      <InvoiceForm
        options={options}
        invoice={invoice}
        defaults={defaults}
        onDone={onClose}
        onCancel={onClose}
      />
    </Modal>
  );
}
