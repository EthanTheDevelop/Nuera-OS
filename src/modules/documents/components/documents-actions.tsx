"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { AddDocumentDialog } from "./add-document-dialog";
import { ArticleDialog } from "./article-dialog";
import { TemplateDialog } from "./template-dialog";

/** En-tête de l'écran 23 : chaque bouton n'apparaît qu'avec le droit correspondant. */
export function DocumentsHeaderActions({
  canManageTemplates,
  canCreateDocument,
  companies,
  storageConfigured,
  maxBytes,
}: {
  canManageTemplates: boolean;
  canCreateDocument: boolean;
  companies: readonly { id: string; name: string }[];
  storageConfigured: boolean;
  maxBytes: number;
}) {
  const [dialog, setDialog] = useState<"template" | "document" | null>(null);
  const close = useCallback(() => setDialog(null), []);

  return (
    <>
      {canManageTemplates ? (
        <Button onClick={() => setDialog("template")}>Nouveau modèle</Button>
      ) : null}
      {canCreateDocument ? (
        <Button variant="accent" onClick={() => setDialog("document")}>
          + Ajouter un document
        </Button>
      ) : null}
      <TemplateDialog open={dialog === "template"} onClose={close} />
      <AddDocumentDialog
        open={dialog === "document"}
        onClose={close}
        companies={companies}
        storageConfigured={storageConfigured}
        maxBytes={maxBytes}
      />
    </>
  );
}

export function AddTemplateButton({ label = "Nouveau modèle" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <TemplateDialog open={open} onClose={close} />
    </>
  );
}

/** « Ajouter » de la carte Base de connaissances, ou bouton d'en-tête avec `prominent`. */
export function AddArticleButton({ prominent = false }: { prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {prominent ? (
        <Button variant="accent" onClick={() => setOpen(true)}>
          + Nouvel article
        </Button>
      ) : (
        <CompactButton variant="quiet" onClick={() => setOpen(true)}>
          Ajouter
        </CompactButton>
      )}
      <ArticleDialog open={open} onClose={close} />
    </>
  );
}
