"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateField, FormAlert, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { IDLE_CRM_STATE, type CrmActionState } from "@/modules/crm/crm.action-state";
import {
  archiveOpportunityAction,
  restoreOpportunityAction,
  setNextActionAction,
} from "../opportunity.actions";

/** Prochaine action et date de relance. Colonnes de Nuera : disponibles même si Twenty est coupé. */
export function NextActionButton({
  opportunityId,
  nextAction,
  nextActionOn,
}: {
  opportunityId: string;
  nextAction: string | null;
  nextActionOn: string | null;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [state, action] = useActionState(
    async (previous: CrmActionState, formData: FormData): Promise<CrmActionState> => {
      const result = await setNextActionAction(opportunityId, previous, formData);
      if (result.status === "success") {
        toast({ message: result.message });
        setOpen(false);
      }
      return result;
    },
    IDLE_CRM_STATE,
  );
  return (
    <>
      <CompactButton variant="quiet" icon="edit" onClick={() => setOpen(true)}>
        {nextAction ? "Modifier" : "Définir"}
      </CompactButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Prochaine action" width={480}>
        <form action={action} className="contents" noValidate>
          <ModalRow>
            <FormAlert state={state} />
          </ModalRow>
          <ModalRow className="flex flex-col gap-4">
            <TextField
              state={state}
              name="nextAction"
              label="Action"
              placeholder="Relancer après l'envoi du devis"
              defaultValue={nextAction ?? ""}
              data-autofocus
            />
            <DateField
              state={state}
              name="nextActionOn"
              label="Date de relance"
              defaultValue={nextActionOn ?? ""}
            />
          </ModalRow>
          <ModalRow className="flex flex-wrap justify-end gap-3">
            <Button onClick={() => setOpen(false)}>Annuler</Button>
            <SubmitButton>Enregistrer</SubmitButton>
          </ModalRow>
        </form>
      </Modal>
    </>
  );
}

export function ArchiveOpportunityButton({
  opportunity,
}: {
  opportunity: { id: string; name: string; archived: boolean };
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { archived } = opportunity;
  return (
    <>
      <CompactButton
        variant="quiet"
        icon={archived ? "check" : "minus"}
        onClick={() => setOpen(true)}
      >
        {archived ? "Restaurer" : "Archiver"}
      </CompactButton>
      <ConfirmDialog
        open={open}
        title={`${archived ? "Restaurer" : "Archiver"} ${opportunity.name} ?`}
        description={
          archived
            ? "L'affaire revient dans le pipeline et dans Twenty."
            : "L'affaire sort du pipeline. Son historique reste en place, et la restauration reste possible."
        }
        confirmLabel={archived ? "Restaurer" : "Archiver"}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const result = archived
            ? await restoreOpportunityAction(opportunity.id)
            : await archiveOpportunityAction(opportunity.id);
          if (result.status === "success") toast({ message: result.message });
          if (result.status === "error") toast({ message: result.message, tone: "danger" });
          setOpen(false);
        }}
      />
    </>
  );
}
