"use client";

import { useId, useState, type ReactNode } from "react";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { allowedTypeFor } from "@/integrations/storage/file-types";
import type { UploadedDocument } from "../document.types";
import { FileDropzone } from "./file-dropzone";
import { useFileUpload, type UploadFailure, type UploadTarget } from "./use-file-upload";

export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Champ de dépôt réutilisable, pour tous les lots (ticket, livrable, contenu attendu, message…).
 * Le fichier part dès qu'il est choisi et crée un document rattaché à `target`. L'identifiant du
 * document est remis à `onUploaded` et, avec `name`, posé dans un champ caché du formulaire parent.
 *
 * ```tsx
 * <UploadField name="documentId" label="Pièce jointe"
 *   target={{ kind: "deliverable", companyId, projectId }} />
 * ```
 *
 * Depuis le portail, la même route impose le client, la visibilité et l'origine, quoi que dise
 * `target`. Sans `target.title`, le nom du fichier sert de titre.
 */
export function UploadField({
  name,
  id,
  label,
  hint,
  target,
  documentId,
  maxBytes = DEFAULT_MAX_BYTES,
  disabled = false,
  dropLabel,
  className,
  onUploaded,
}: {
  /** Nom du champ caché qui reçoit l'identifiant du document. */
  name?: string;
  id?: string;
  label: ReactNode;
  hint?: string;
  target?: UploadTarget;
  /** Ajoute une version à ce document au lieu d'en créer un. */
  documentId?: string;
  /** Contrôle de confort avant l'envoi : le serveur reste seul juge. */
  maxBytes?: number;
  disabled?: boolean;
  dropLabel?: string;
  className?: string;
  onUploaded?: (document: UploadedDocument) => void;
}) {
  const fallbackId = useId();
  const controlId = id ?? fallbackId;
  const toast = useToast();
  const { progress, uploading, uploadDocument, uploadVersion } = useFileUpload();
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadedDocument | null>(null);
  const [error, setError] = useState<string>();

  async function send(selected: File) {
    setFile(selected);
    setUploaded(null);
    setError(undefined);
    if (!allowedTypeFor(selected.name)) {
      setError("Ce type de fichier n'est pas accepté.");
      return;
    }
    if (selected.size > maxBytes) {
      setError(`Ce fichier dépasse la taille maximale de ${Math.round(maxBytes / 1048576)} Mo.`);
      return;
    }
    try {
      const document = documentId
        ? await uploadVersion(documentId, selected, target?.note)
        : await uploadDocument(selected, { ...target, title: target?.title || selected.name });
      setUploaded(document);
      toast({
        message: document.created ? "Fichier déposé." : "Ce fichier était déjà déposé.",
        tone: "success",
      });
      onUploaded?.(document);
    } catch (failure) {
      setError((failure as UploadFailure).message);
    }
  }

  return (
    <Field
      id={controlId}
      label={label}
      error={error}
      hint={uploaded ? `Déposé en version ${uploaded.version}.` : uploading ? undefined : hint}
      className={className}
    >
      {name ? <input type="hidden" name={name} value={uploaded?.id ?? ""} /> : null}
      <FileDropzone
        id={controlId}
        file={file}
        progress={progress}
        invalid={Boolean(error)}
        disabled={disabled}
        label={dropLabel}
        describedBy={error ? `${controlId}-error` : undefined}
        onFile={send}
      />
    </Field>
  );
}
