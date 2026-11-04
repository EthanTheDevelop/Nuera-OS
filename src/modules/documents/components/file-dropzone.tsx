"use client";

import { useId, useState, type DragEvent } from "react";
import { Gauge } from "@/components/ui/gauge";
import { Icon } from "@/components/ui/icon";
import { ALLOWED_TYPES_LABEL, FILE_INPUT_ACCEPT } from "@/integrations/storage/file-types";
import { cn } from "@/lib/cn";
import { formatFileSize } from "../document.format";

/**
 * Zone de dépôt, même dessin que la tuile « Ajouter » (Figma 58:621) : pointillés, plus 18 dans un
 * rond accent pâle. Un vrai `<input type="file">` : clavier, lecteur d'écran et appareil photo
 * fonctionnent. Sans logique d'envoi : voir `UploadField` et `useFileUpload`.
 */
export function FileDropzone({
  id,
  file,
  progress = null,
  invalid = false,
  disabled = false,
  label = "Déposer un fichier ou parcourir",
  hint,
  describedBy,
  onFile,
}: {
  id?: string;
  file: { name: string; size: number } | null;
  /** 0 à 100 pendant l'envoi. */
  progress?: number | null;
  invalid?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  describedBy?: string;
  onFile: (file: File) => void;
}) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const [dragging, setDragging] = useState(false);
  const uploading = progress !== null;

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled || uploading) return;
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && !uploading) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed p-4 text-center transition-colors duration-(--dur-fast)",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        invalid ? "border-danger" : dragging ? "border-accent bg-accent-pale/40" : "border-border",
        !disabled && !invalid && "hover:border-accent hover:bg-accent-pale/40",
      )}
    >
      <input
        id={inputId}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        disabled={disabled || uploading}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="sr-only"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) onFile(selected);
          // Reprendre le même fichier après une erreur doit redéclencher le choix.
          event.target.value = "";
        }}
      />
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full bg-accent-pale text-accent"
      >
        <Icon name={file ? "devis" : "plus"} size={18} />
      </span>
      {file ? (
        <span className="max-w-full min-w-0 text-sm font-medium break-words text-text">
          {file.name} <span className="font-normal text-muted">· {formatFileSize(file.size)}</span>
        </span>
      ) : (
        <span className="text-nav-search font-medium text-accent">{label}</span>
      )}
      {uploading ? (
        <Gauge
          value={progress}
          label="Envoi du fichier"
          valueText={`${progress} %`}
          className="w-full max-w-60"
        />
      ) : (
        <span className="text-xs text-muted">{hint ?? ALLOWED_TYPES_LABEL}</span>
      )}
    </label>
  );
}
