"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { ConnectionRequired } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, TextField } from "@/components/ui/form";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { allowedTypeFor } from "@/integrations/storage/file-types";
import { fieldError, IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { FileDropzone } from "./file-dropzone";
import { useFileUpload, type UploadFailure } from "./use-file-upload";

function NewVersionForm({
  documentId,
  maxBytes,
  onClose,
}: {
  documentId: string;
  maxBytes: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { progress, uploading, uploadVersion } = useFileUpload();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ActionState>(IDLE_ACTION_STATE);
  const fileError = fieldError(state, "file");

  function choose(selected: File) {
    setFile(selected);
    setState(IDLE_ACTION_STATE);
    if (!allowedTypeFor(selected.name)) {
      const message = "Ce type de fichier n'est pas accepté.";
      setState({ status: "error", message, fieldErrors: { file: [message] } });
    } else if (selected.size > maxBytes) {
      const message = `Ce fichier dépasse la taille maximale de ${Math.round(maxBytes / 1048576)} Mo.`;
      setState({ status: "error", message, fieldErrors: { file: [message] } });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    if (!file) {
      const message = "Choisissez un fichier à déposer.";
      setState({ status: "error", message, fieldErrors: { file: [message] } });
      return;
    }
    const note = new FormData(event.currentTarget).get("note");
    setState(IDLE_ACTION_STATE);
    try {
      const uploaded = await uploadVersion(
        documentId,
        file,
        typeof note === "string" ? note : undefined,
      );
      toast({
        message: uploaded.created
          ? `Version ${uploaded.version} ajoutée.`
          : "Ce fichier est identique à la version de référence : rien n'a changé.",
        tone: uploaded.created ? "success" : "info",
      });
      router.refresh();
      onClose();
    } catch (failure) {
      const { message, fieldErrors } = failure as UploadFailure;
      setState({ status: "error", message, fieldErrors });
    }
  }

  return (
    <form onSubmit={submit} className="contents" noValidate>
      {state.status === "error" && !fileError ? (
        <ModalRow>
          <FormAlert state={state} />
        </ModalRow>
      ) : null}
      <ModalRow>
        <Field id="version-file" label="Fichier" error={fileError}>
          <FileDropzone
            id="version-file"
            file={file}
            progress={progress}
            invalid={Boolean(fileError)}
            describedBy={fileError ? "version-file-error" : undefined}
            onFile={choose}
          />
        </Field>
      </ModalRow>
      <ModalRow>
        <TextField
          state={state}
          id="version-note"
          name="note"
          label="Ce qui change"
          hint="Facultatif. Visible dans l'historique, jamais par le client."
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose} disabled={uploading}>
          Annuler
        </Button>
        <Button type="submit" variant="accent" loading={uploading}>
          Ajouter la version
        </Button>
      </ModalRow>
    </form>
  );
}

export function NewVersionButton({
  documentId,
  storageConfigured,
  maxBytes,
}: {
  documentId: string;
  storageConfigured: boolean;
  maxBytes: number;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        + Nouvelle version
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Nouvelle version"
        description="Elle devient la version de référence. Un document validé ou signé repasse en brouillon."
        icon="devis"
        width={560}
      >
        {storageConfigured ? (
          <NewVersionForm documentId={documentId} maxBytes={maxBytes} onClose={close} />
        ) : (
          <ModalRow>
            <ConnectionRequired
              compact
              service="stockage des fichiers"
              missing="Le dossier de stockage n'est pas configuré sur ce serveur."
            />
          </ModalRow>
        )}
      </Modal>
    </>
  );
}
