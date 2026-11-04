"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/feedback";
import { FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { DurationField, MoneyField, SubmitButton } from "@/components/ui/form-client";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  CATALOG_ITEM_KIND_LABELS,
  CATALOG_ITEM_KINDS,
  OFFER_ACTIVITIES,
  OFFER_ACTIVITY_LABELS,
} from "@/lib/domain-enums";
import { saveCatalogItemAction } from "../catalog.actions";

export interface CatalogItemFormValues {
  id: string;
  kind: string;
  activity: string;
  name: string;
  description: string | null;
  priceCents: number;
  estimatedCostCents: number;
  estimatedMinutes: number;
  scope: string | null;
  exclusions: string | null;
  conditions: string | null;
  validityDays: number | null;
  depositPercent: number | null;
}

/** Création et modification d'une prestation : prix, coûts, périmètre, conditions, validité, acompte. */
export function CatalogItemForm({
  item,
  footer,
}: {
  item?: CatalogItemFormValues;
  footer?: React.ReactNode;
}) {
  const [state, action] = useActionState(saveCatalogItemAction, IDLE_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormAlert state={state} />
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          state={state}
          name="kind"
          label="Type"
          defaultValue={item?.kind ?? "project"}
          required
        >
          {CATALOG_ITEM_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CATALOG_ITEM_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <SelectField
          state={state}
          name="activity"
          label="Activité"
          defaultValue={item?.activity ?? "vitrine"}
          required
        >
          {OFFER_ACTIVITIES.map((activity) => (
            <option key={activity} value={activity}>
              {OFFER_ACTIVITY_LABELS[activity]}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField state={state} name="name" label="Nom" defaultValue={item?.name} required />
      <TextareaField
        state={state}
        name="description"
        label="Description"
        rows={2}
        defaultValue={item?.description ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyField
          state={state}
          name="priceCents"
          label="Prix HT"
          defaultCents={item?.priceCents ?? null}
        />
        <MoneyField
          state={state}
          name="estimatedCostCents"
          label="Coût estimé"
          defaultCents={item?.estimatedCostCents ?? null}
        />
        <DurationField
          state={state}
          name="estimatedMinutes"
          label="Temps estimé"
          hint="1h30, 90 ou 0,5 j"
          defaultMinutes={item?.estimatedMinutes ?? null}
        />
      </div>
      <TextareaField
        state={state}
        name="scope"
        label="Périmètre"
        rows={3}
        defaultValue={item?.scope ?? ""}
      />
      <TextareaField
        state={state}
        name="exclusions"
        label="Exclusions"
        rows={2}
        defaultValue={item?.exclusions ?? ""}
      />
      <TextareaField
        state={state}
        name="conditions"
        label="Conditions"
        rows={2}
        defaultValue={item?.conditions ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="validityDays"
          label="Validité de l'offre, en jours"
          inputMode="numeric"
          defaultValue={item?.validityDays ?? ""}
        />
        <TextField
          state={state}
          name="depositPercent"
          label="Acompte, en %"
          inputMode="numeric"
          defaultValue={item?.depositPercent ?? ""}
        />
      </div>
      {item ? (
        <Alert tone="info">
          Les devis existants gardent leurs lignes telles quelles : seul un nouveau devis reprendra
          ces valeurs.
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        {footer}
        <SubmitButton>{item ? "Enregistrer" : "Créer la prestation"}</SubmitButton>
      </div>
    </form>
  );
}
