"use client";

import { useCallback, useState } from "react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { DateField, FormAlert, SelectField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Tile } from "@/components/ui/tile";
import { formatDateShort } from "@/lib/format";
import {
  createRequirementAction,
  markRequirementReceivedAction,
  reopenRequirementAction,
  updateRequirementAction,
} from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { useCommand, useWindowForm } from "./use-project-command";

type Requirement = ProjectDetail["requirements"][number];

function RequirementForm({
  projectId,
  requirement,
  onDone,
}: {
  projectId: string;
  requirement?: Requirement;
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(
    requirement ? updateRequirementAction : createRequirementAction,
    onDone,
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormAlert state={state} />
      {requirement ? (
        <input type="hidden" name="requirementId" value={requirement.id} />
      ) : (
        <input type="hidden" name="projectId" value={projectId} />
      )}
      <TextField
        state={state}
        name="label"
        label="Contenu attendu"
        required
        defaultValue={requirement?.label}
      />
      <DateField
        state={state}
        name="dueOn"
        label="Attendu pour le"
        defaultValue={requirement?.dueOn ?? ""}
      />
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>{requirement ? "Enregistrer" : "Ajouter"}</SubmitButton>
      </div>
    </form>
  );
}

function ReceiveForm({
  requirement,
  documents,
  onDone,
}: {
  requirement: Requirement;
  documents: readonly { id: string; title: string }[];
  onDone: () => void;
}) {
  const { state, formAction } = useWindowForm(markRequirementReceivedAction, onDone);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormAlert state={state} />
      <input type="hidden" name="requirementId" value={requirement.id} />
      <SelectField
        state={state}
        name="documentId"
        label="Document reçu"
        hint={documents.length === 0 ? "Aucun document sur ce projet pour l’instant." : undefined}
        defaultValue=""
      >
        <option value="">Sans document</option>
        {documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.title}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Marquer comme reçu</SubmitButton>
      </div>
    </form>
  );
}

/** Contenus attendus du client. Rien dans Figma : même langage que la carte Validation client. */
export function RequirementCard({
  projectId,
  requirements,
  documents,
  editable,
}: {
  projectId: string;
  requirements: readonly Requirement[];
  documents: readonly { id: string; title: string }[];
  editable: boolean;
}) {
  const { run, pending } = useCommand();
  const [dialog, setDialog] = useState<{ mode: "edit" | "receive" | "new"; id?: string } | null>(
    null,
  );
  const close = useCallback(() => setDialog(null), []);
  const current = requirements.find((requirement) => requirement.id === dialog?.id);
  const expected = requirements.filter((requirement) => requirement.status === "expected").length;

  return (
    <Tile
      icon="paperclip"
      title="Contenus attendus"
      className="gap-3 rounded-lg p-6"
      aside={
        editable ? (
          <CompactButton variant="quiet" icon="plus" onClick={() => setDialog({ mode: "new" })}>
            Ajouter
          </CompactButton>
        ) : undefined
      }
    >
      {requirements.length === 0 ? (
        <p className="text-sm text-muted">Rien n’est attendu du client.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requirements.map((requirement) => (
            <li key={requirement.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3 text-sm text-text">
                <span className="min-w-0">
                  {requirement.label}
                  {requirement.status === "expected" && requirement.dueOn ? (
                    <span className="text-muted"> · {formatDateShort(requirement.dueOn)}</span>
                  ) : null}
                </span>
                <StatusBadge kind="requirement" status={requirement.status} className="shrink-0" />
              </div>
              {editable ? (
                <div className="flex flex-wrap gap-4">
                  {requirement.status === "expected" ? (
                    <CompactButton
                      variant="quiet"
                      onClick={() => setDialog({ mode: "receive", id: requirement.id })}
                    >
                      Marquer comme reçu
                    </CompactButton>
                  ) : (
                    <CompactButton
                      variant="quiet"
                      loading={pending}
                      onClick={() => run(() => reopenRequirementAction(requirement.id))}
                    >
                      Rouvrir
                    </CompactButton>
                  )}
                  <CompactButton
                    variant="quiet"
                    onClick={() => setDialog({ mode: "edit", id: requirement.id })}
                  >
                    Modifier
                  </CompactButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {expected > 0 && !editable ? (
        <p className="text-xs text-muted">
          {expected} contenu{expected > 1 ? "s" : ""} attendu{expected > 1 ? "s" : ""}.
        </p>
      ) : null}
      <Modal
        open={dialog !== null}
        onClose={close}
        width={480}
        title={
          dialog?.mode === "receive"
            ? "Contenu reçu"
            : dialog?.mode === "edit"
              ? "Modifier le contenu attendu"
              : "Nouveau contenu attendu"
        }
      >
        <ModalRow>
          {dialog?.mode === "receive" && current ? (
            <ReceiveForm requirement={current} documents={documents} onDone={close} />
          ) : (
            <RequirementForm
              key={dialog?.id ?? "new"}
              projectId={projectId}
              requirement={dialog?.mode === "edit" ? current : undefined}
              onDone={close}
            />
          )}
        </ModalRow>
      </Modal>
    </Tile>
  );
}
