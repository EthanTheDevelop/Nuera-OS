"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ConnectionRequired } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Field, FormAlert, Select, TextField } from "@/components/ui/form";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { allowedTypeFor } from "@/integrations/storage/file-types";
import { fieldError, type ActionState, IDLE_ACTION_STATE } from "@/lib/action-state";
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITIES,
  DOCUMENT_VISIBILITY_LABELS,
} from "@/lib/domain-enums";
import { FileDropzone } from "./file-dropzone";
import { LinkFields } from "./link-fields";
import { useFileUpload, type UploadFailure } from "./use-file-upload";

const withoutExtension = (filename: string) => filename.replace(/\.[^.]+$/, "");

function AddDocumentForm({
  companies,
  maxBytes,
  onClose,
}: {
  companies: readonly { id: string; name: string }[];
  maxBytes: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { progress, uploading, uploadDocument } = useFileUpload();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [state, setState] = useState<ActionState>(IDLE_ACTION_STATE);
  const [notConfigured, setNotConfigured] = useState(false);
  const fileError = fieldError(state, "file");

  function chooseFile(selected: File) {
    setFile(selected);
    setState(IDLE_ACTION_STATE);
    setTitle((current) => current || withoutExtension(selected.name));
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
    const fields = Object.fromEntries(
      [...new FormData(event.currentTarget).entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    setState(IDLE_ACTION_STATE);
    try {
      const document = await uploadDocument(file, { ...fields, title });
      toast({
        message: document.created ? "Document ajouté." : "Ce document était déjà déposé.",
        tone: "success",
      });
      router.refresh();
      onClose();
    } catch (failure) {
      const { message, fieldErrors, connectionRequired } = failure as UploadFailure;
      if (connectionRequired) setNotConfigured(true);
      setState({ status: "error", message, fieldErrors });
    }
  }

  if (notConfigured) {
    return (
      <ModalRow>
        <ConnectionRequired
          compact
          service="stockage des fichiers"
          missing="Le dossier de stockage n'est pas configuré sur ce serveur."
        />
      </ModalRow>
    );
  }

  return (
    <form onSubmit={submit} className="contents" noValidate>
      {state.status === "error" && !fileError ? (
        <ModalRow>
          <FormAlert state={state} />
        </ModalRow>
      ) : null}
      <ModalRow>
        <Field id="file" label="Fichier" error={fileError}>
          <FileDropzone
            id="file"
            file={file}
            progress={progress}
            invalid={Boolean(fileError)}
            describedBy={fileError ? "file-error" : undefined}
            hint={`PDF, images, Office, ZIP, texte · ${Math.round(maxBytes / 1048576)} Mo au plus`}
            onFile={chooseFile}
          />
        </Field>
      </ModalRow>
      <ModalRow className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          name="title"
          label="Titre"
          required
          fieldClassName="sm:col-span-2"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Field id="kind" label="Type">
          <Select id="kind" name="kind" defaultValue="other">
            {DOCUMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DOCUMENT_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="status" label="Statut">
          <Select id="status" name="status" defaultValue="final">
            {DOCUMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {DOCUMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
        <LinkFields companies={companies} state={state} />
        <Field
          id="visibility"
          label="Partage"
          className="sm:col-span-2"
          error={fieldError(state, "visibility")}
        >
          <Select id="visibility" name="visibility" defaultValue="internal">
            {DOCUMENT_VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {DOCUMENT_VISIBILITY_LABELS[visibility]}
              </option>
            ))}
          </Select>
        </Field>
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose} disabled={uploading}>
          Annuler
        </Button>
        <Button type="submit" variant="accent" loading={uploading}>
          Ajouter le document
        </Button>
      </ModalRow>
    </form>
  );
}

/** « + Ajouter un document » : le fichier part en flux vers la route de dépôt, rien avant l'envoi. */
export function AddDocumentDialog({
  open,
  onClose,
  companies,
  storageConfigured,
  maxBytes,
}: {
  open: boolean;
  onClose: () => void;
  companies: readonly { id: string; name: string }[];
  storageConfigured: boolean;
  maxBytes: number;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Ajouter un document" icon="devis" width={640}>
      {storageConfigured ? (
        <AddDocumentForm companies={companies} maxBytes={maxBytes} onClose={onClose} />
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
  );
}
