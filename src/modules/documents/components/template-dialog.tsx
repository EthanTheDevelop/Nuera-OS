"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Field,
  FormAlert,
  fieldDescription,
  Select,
  SelectField,
  Textarea,
  TextField,
} from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Button } from "@/components/ui/button";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { fieldError, IDLE_ACTION_STATE, submittedValue } from "@/lib/action-state";
import {
  OFFER_ACTIVITIES,
  OFFER_ACTIVITY_LABELS,
  TEMPLATE_KIND_LABELS,
  TEMPLATE_KINDS,
  type TemplateKind,
} from "@/lib/domain-enums";
import { saveTemplateAction } from "../template.actions";
import type { TemplateRow } from "../document.types";

const isStructured = (kind: TemplateKind) => kind === "checklist" || kind === "project_plan";

const ITEMS_LABEL: Partial<Record<TemplateKind, string>> = {
  checklist: "Points à contrôler",
  project_plan: "Jalons du plan",
};

function TemplateForm({ template, onClose }: { template?: TemplateRow; onClose: () => void }) {
  const [state, action] = useActionState(saveTemplateAction, IDLE_ACTION_STATE);
  const [kind, setKind] = useState<TemplateKind>(template?.kind ?? "brief");
  const structured = isStructured(kind);
  const contentField = structured ? "items" : "body";
  const contentError = fieldError(state, contentField);

  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <form action={action} className="contents">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <ModalRow>
        <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
      </ModalRow>
      <ModalRow className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="template-kind" label="Type">
          <Select
            id="template-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as TemplateKind)}
          >
            {TEMPLATE_KINDS.map((value) => (
              <option key={value} value={value}>
                {TEMPLATE_KIND_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <SelectField
          state={state}
          id="template-activity"
          name="activity"
          label="Prestation"
          defaultValue={template?.activity ?? ""}
        >
          <option value="">Toutes les prestations</option>
          {OFFER_ACTIVITIES.map((value) => (
            <option key={value} value={value}>
              {OFFER_ACTIVITY_LABELS[value]}
            </option>
          ))}
        </SelectField>
        <TextField
          state={state}
          id="template-name"
          name="name"
          label="Nom"
          required
          data-autofocus
          defaultValue={template?.name}
          fieldClassName="sm:col-span-2"
        />
        <Field
          id="template-content"
          label={structured ? ITEMS_LABEL[kind] : "Texte"}
          hint={structured ? "Un élément par ligne." : undefined}
          error={contentError}
          className="sm:col-span-2"
        >
          <Textarea
            key={contentField}
            id="template-content"
            name={contentField}
            rows={8}
            defaultValue={
              submittedValue(state, contentField) ??
              (structured ? template?.items.join("\n") : (template?.body ?? ""))
            }
            {...fieldDescription("template-content", {
              hint: structured ? "Un élément par ligne." : undefined,
              error: contentError,
            })}
          />
        </Field>
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <SubmitButton>{template ? "Enregistrer" : "Créer le modèle"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** « Nouveau modèle », ou modification d'un modèle existant. */
export function TemplateDialog({
  open,
  onClose,
  template,
}: {
  open: boolean;
  onClose: () => void;
  template?: TemplateRow;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template ? "Modifier le modèle" : "Nouveau modèle"}
      icon="edit"
      width={640}
    >
      {open ? <TemplateForm template={template} onClose={onClose} /> : null}
    </Modal>
  );
}
