"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, Select, SelectField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { createQuoteAction, listOpportunityOptionsAction } from "../quote.actions";

export interface CompanyChoice {
  id: string;
  name: string;
}

/**
 * « + Nouveau devis » (non dessiné). Le client et l'offre suffisent : l'éditeur s'ouvre ensuite.
 * `initial` : ouverture directe depuis une affaire (`/devis?nouveau=1&client=…&affaire=…`).
 */
export function NewQuoteButton({
  companies,
  initial,
}: {
  companies: readonly CompanyChoice[];
  initial?: { open: boolean; companyId?: string; opportunityId?: string };
}) {
  const [open, setOpen] = useState(initial?.open ?? false);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        + Nouveau devis
      </Button>
      {open ? (
        <NewQuoteDialog
          companies={companies}
          initialCompanyId={initial?.companyId}
          initialOpportunityId={initial?.opportunityId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function NewQuoteDialog({
  companies,
  initialCompanyId,
  initialOpportunityId,
  onClose,
}: {
  companies: readonly CompanyChoice[];
  initialCompanyId?: string;
  initialOpportunityId?: string;
  onClose: () => void;
}) {
  const [state, action] = useActionState(createQuoteAction, IDLE_ACTION_STATE);
  // Le client vient de l'URL : on ne garde que ce que la liste propose vraiment.
  const [companyId, setCompanyId] = useState(
    companies.some((company) => company.id === initialCompanyId) ? (initialCompanyId ?? "") : "",
  );
  const [opportunities, setOpportunities] = useState<{ id: string; name: string }[]>([]);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    if (!companyId) return;
    startLoading(async () => {
      setOpportunities(await listOpportunityOptionsAction(companyId));
    });
  }, [companyId]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Nouveau devis"
      description="Le numéro est attribué à la création. Vous composez ensuite les lignes depuis le catalogue."
      width={520}
    >
      <ModalRow>
        <form action={action} className="flex flex-col gap-4">
          <FormAlert state={state} />
          <SelectField
            state={state}
            name="companyId"
            label="Client"
            value={companyId}
            onChange={(event) => {
              setOpportunities([]);
              setCompanyId(event.target.value);
            }}
            required
            data-autofocus
          >
            <option value="">Choisir un client</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </SelectField>
          <Field
            id="opportunityId"
            label="Affaire"
            hint={loading ? "Chargement des affaires…" : "Facultatif : gagnée à la signature."}
          >
            <Select
              id="opportunityId"
              name="opportunityId"
              defaultValue={initialOpportunityId ?? ""}
              key={opportunities.map((item) => item.id).join()}
              disabled={!companyId}
            >
              <option value="">Sans affaire</option>
              {opportunities.map((opportunity) => (
                <option key={opportunity.id} value={opportunity.id}>
                  {opportunity.name}
                </option>
              ))}
            </Select>
          </Field>
          <TextField state={state} name="title" label="Offre" placeholder="Site vitrine" required />
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={onClose}>Annuler</Button>
            <SubmitButton>Créer le devis</SubmitButton>
          </div>
        </form>
      </ModalRow>
    </Modal>
  );
}
