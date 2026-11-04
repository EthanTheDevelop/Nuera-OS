"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert, SelectField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast, useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DOCUMENT_STATUS_LABELS,
  type DocumentStatus,
} from "@/lib/domain-enums";
import {
  archiveDocumentAction,
  restoreDocumentAction,
  setDocumentStatusAction,
  setDocumentVisibilityAction,
  setReferenceVersionAction,
  updateDocumentAction,
} from "../document.actions";
import { DOCUMENT_TRANSITIONS } from "../document.status";
import type { CompanyLinkOptions, DocumentRow } from "../document.types";
import { LinkFields } from "./link-fields";

function EditDocumentForm({
  document,
  companies,
  linkOptions,
  onClose,
}: {
  document: DocumentRow;
  companies: readonly { id: string; name: string }[];
  linkOptions: CompanyLinkOptions | null;
  onClose: () => void;
}) {
  const [state, action] = useActionState(updateDocumentAction, IDLE_ACTION_STATE);

  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <form action={action} className="contents">
      <input type="hidden" name="id" value={document.id} />
      <ModalRow>
        <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
      </ModalRow>
      <ModalRow className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          id="title"
          name="title"
          label="Titre"
          required
          data-autofocus
          defaultValue={document.title}
          fieldClassName="sm:col-span-2"
        />
        <SelectField
          state={state}
          id="kind"
          name="kind"
          label="Type"
          defaultValue={document.kind}
          fieldClassName="sm:col-span-2"
        >
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {DOCUMENT_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <LinkFields
          companies={companies}
          state={state}
          initial={document}
          initialOptions={linkOptions ?? undefined}
          disabled={document.uploadedByClient}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <SubmitButton>Enregistrer</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** « Modifier » de la carte Détails : titre, type et rattachements. */
export function EditDocumentButton({
  document,
  companies,
  linkOptions,
}: {
  document: DocumentRow;
  companies: readonly { id: string; name: string }[];
  linkOptions: CompanyLinkOptions | null;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Modifier
      </CompactButton>
      <Modal open={open} onClose={close} title="Modifier le document" icon="edit" width={640}>
        {open ? (
          <EditDocumentForm
            document={document}
            companies={companies}
            linkOptions={linkOptions}
            onClose={close}
          />
        ) : null}
      </Modal>
    </>
  );
}

/** Exécute une Server Action sans formulaire et affiche son résultat. */
function useRunAction() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = useCallback(
    (call: () => Promise<ActionState>, after?: () => void) => {
      startTransition(async () => {
        const result = await call();
        if (result.status === "success") toast({ message: result.message, tone: "success" });
        if (result.status === "error") toast({ message: result.message, tone: "danger" });
        after?.();
      });
    },
    [toast],
  );
  return { pending, run };
}

/** Partage, statut et archivage, sur la fiche d'un document. */
export function DocumentControls({ document }: { document: DocumentRow }) {
  const { pending, run } = useRunAction();
  const [dialog, setDialog] = useState<"share" | "archive" | null>(null);
  const archived = Boolean(document.archivedAt);
  const shared = document.visibility === "client";

  if (archived) {
    return (
      <CompactButton
        variant="secondary"
        loading={pending}
        onClick={() => run(() => restoreDocumentAction(document.id))}
      >
        Restaurer le document
      </CompactButton>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {document.uploadedByClient ? null : (
        <div className="flex flex-wrap gap-2">
          <CompactButton
            variant="secondary"
            disabled={pending}
            onClick={() =>
              shared
                ? run(() => setDocumentVisibilityAction(document.id, "internal"))
                : setDialog("share")
            }
          >
            {shared ? "Repasser en interne" : "Partager au client"}
          </CompactButton>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {DOCUMENT_TRANSITIONS[document.status].map((status: DocumentStatus) => (
          <CompactButton
            key={status}
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => setDocumentStatusAction(document.id, status))}
          >
            Passer en « {DOCUMENT_STATUS_LABELS[status]} »
          </CompactButton>
        ))}
      </div>
      <div>
        <CompactButton variant="quiet" disabled={pending} onClick={() => setDialog("archive")}>
          Archiver
        </CompactButton>
      </div>

      <ConfirmDialog
        open={dialog === "share"}
        title="Partager ce document au client ?"
        description={
          document.companyId
            ? `${document.companyName ?? "Le client"} pourra le télécharger depuis son espace, dans sa version de référence.`
            : "Rattachez d'abord ce document à un client."
        }
        confirmLabel="Partager"
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          run(
            () => setDocumentVisibilityAction(document.id, "client"),
            () => setDialog(null),
          )
        }
      />
      <ConfirmDialog
        open={dialog === "archive"}
        title="Archiver ce document ?"
        description="Il disparaît des listes, de l'espace client et du périmètre des prestataires. Ses versions et ses fichiers sont conservés : vous pourrez le restaurer."
        confirmLabel="Archiver"
        tone="danger"
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          run(
            () => archiveDocumentAction(document.id),
            () => setDialog(null),
          )
        }
      />
    </div>
  );
}

/** Désigne une ancienne version comme référence, depuis la liste des versions. */
export function ReferenceVersionButton({
  documentId,
  versionId,
}: {
  documentId: string;
  versionId: string;
}) {
  const { pending, run } = useRunAction();
  return (
    <CompactButton
      variant="quiet"
      loading={pending}
      className="relative z-10"
      onClick={() => run(() => setReferenceVersionAction(documentId, versionId))}
    >
      Prendre comme référence
    </CompactButton>
  );
}
