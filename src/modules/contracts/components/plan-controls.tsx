"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { BILLING_PERIOD_LABELS, BILLING_PERIODS } from "@/lib/domain-enums";
import { createPlanAction, setPlanActiveAction, updatePlanAction } from "../contract.actions";
import type { MaintenancePlanRow } from "../contract.types";
import { useModalForm } from "./use-modal-form";

function PlanForm({ plan, onDone }: { plan?: MaintenancePlanRow; onDone: () => void }) {
  const { state, formAction } = useModalForm(
    plan ? updatePlanAction.bind(null, plan.id) : createPlanAction,
    onDone,
  );
  return (
    <ModalRow>
      <form action={formAction} className="flex flex-col gap-4">
        <FormAlert state={state} />
        <TextField
          state={state}
          name="name"
          label="Nom de la formule"
          defaultValue={plan?.name}
          required
          data-autofocus
        />
        <TextField
          state={state}
          name="description"
          label="Description"
          defaultValue={plan?.description ?? ""}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            state={state}
            name="priceCents"
            label="Prix HT"
            defaultCents={plan?.priceCents ?? null}
            required
          />
          <SelectField
            state={state}
            name="period"
            label="Périodicité"
            defaultValue={plan?.period ?? "monthly"}
          >
            {BILLING_PERIODS.map((period) => (
              <option key={period} value={period}>
                {BILLING_PERIOD_LABELS[period]}
              </option>
            ))}
          </SelectField>
          <DurationField
            state={state}
            name="includedMinutes"
            label="Temps inclus par période"
            hint="Vide : pas de quota. 0 : aucun temps inclus."
            defaultMinutes={plan?.includedMinutes ?? null}
          />
          <TextField
            state={state}
            name="includedTickets"
            label="Demandes incluses par période"
            type="number"
            min={0}
            defaultValue={plan?.includedTickets ?? ""}
          />
          <TextField
            state={state}
            name="responseHours"
            label="Délai de réponse (heures)"
            type="number"
            min={0}
            defaultValue={plan?.responseHours ?? ""}
          />
          <TextField
            state={state}
            name="resolutionHours"
            label="Délai de résolution (heures)"
            type="number"
            min={0}
            defaultValue={plan?.resolutionHours ?? ""}
          />
        </div>
        <TextareaField
          state={state}
          name="scope"
          label="Inclus"
          rows={3}
          defaultValue={plan?.scope ?? ""}
        />
        <TextareaField
          state={state}
          name="exclusions"
          label="Exclusions"
          rows={3}
          defaultValue={plan?.exclusions ?? ""}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onDone}>Annuler</Button>
          <SubmitButton>{plan ? "Enregistrer" : "Créer la formule"}</SubmitButton>
        </div>
      </form>
    </ModalRow>
  );
}

export function NewPlanButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        + Nouvelle formule
      </Button>
      <Modal open={open} onClose={close} title="Nouvelle formule" icon="contrat" width={640}>
        <PlanForm onDone={close} />
      </Modal>
    </>
  );
}

/** Actions d'une ligne du tableau : `relative z-10` les place au-dessus du lien de ligne. */
export function PlanRowActions({ plan }: { plan: MaintenancePlanRow }) {
  const [dialog, setDialog] = useState<"edit" | "retire" | null>(null);
  const toast = useToast();
  const close = useCallback(() => setDialog(null), []);

  async function setActive(active: boolean) {
    const result = await setPlanActiveAction(plan.id, active);
    if (result.status !== "idle") {
      toast({ message: result.message, tone: result.status === "error" ? "danger" : "success" });
    }
    setDialog(null);
  }

  return (
    <span className="relative z-10 flex justify-end gap-2">
      <CompactButton
        variant="quiet"
        aria-label={`Modifier la formule ${plan.name}`}
        onClick={() => setDialog("edit")}
      >
        Modifier
      </CompactButton>
      {plan.active ? (
        <CompactButton
          variant="quiet"
          aria-label={`Retirer la formule ${plan.name}`}
          onClick={() => setDialog("retire")}
        >
          Retirer
        </CompactButton>
      ) : (
        <CompactButton
          variant="quiet"
          aria-label={`Proposer de nouveau la formule ${plan.name}`}
          onClick={() => setActive(true)}
        >
          Proposer
        </CompactButton>
      )}
      <Modal
        open={dialog === "edit"}
        onClose={close}
        title="Modifier la formule"
        icon="contrat"
        width={640}
      >
        <PlanForm plan={plan} onDone={close} />
      </Modal>
      <ConfirmDialog
        open={dialog === "retire"}
        title={`Retirer la formule ${plan.name}`}
        description={
          plan.contractCount > 0
            ? `Elle ne sera plus proposée. Les ${plan.contractCount} contrat(s) en cours gardent leurs conditions.`
            : "Elle ne sera plus proposée à la création d'un contrat."
        }
        confirmLabel="Retirer"
        onConfirm={() => setActive(false)}
        onCancel={close}
      />
    </span>
  );
}
