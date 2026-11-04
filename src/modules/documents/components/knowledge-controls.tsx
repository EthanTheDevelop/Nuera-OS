"use client";

import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { ActionState } from "@/lib/action-state";
import type { ArticleDetail, TemplateRow } from "../document.types";
import {
  archiveArticleAction,
  restoreArticleAction,
  restoreArticleVersionAction,
} from "../knowledge.actions";
import { setTemplateActiveAction } from "../template.actions";
import { ArticleDialog } from "./article-dialog";
import { TemplateDialog } from "./template-dialog";

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

/** En-tête d'un article : modifier, archiver ou restaurer. */
export function ArticleHeaderActions({ article }: { article: ArticleDetail }) {
  const { pending, run } = useRunAction();
  const [dialog, setDialog] = useState<"edit" | "archive" | null>(null);
  const close = useCallback(() => setDialog(null), []);

  if (article.archivedAt) {
    return (
      <Button
        variant="accent"
        loading={pending}
        onClick={() => run(() => restoreArticleAction(article.id))}
      >
        Restaurer l&apos;article
      </Button>
    );
  }

  return (
    <>
      <Button onClick={() => setDialog("archive")} disabled={pending}>
        Archiver
      </Button>
      <Button variant="accent" onClick={() => setDialog("edit")}>
        Modifier
      </Button>
      <ArticleDialog open={dialog === "edit"} onClose={close} article={article} />
      <ConfirmDialog
        open={dialog === "archive"}
        title="Archiver cet article ?"
        description="Il disparaît de la base de connaissances. Ses versions sont conservées : vous pourrez le restaurer."
        confirmLabel="Archiver"
        tone="danger"
        onCancel={close}
        onConfirm={() => run(() => archiveArticleAction(article.id), close)}
      />
    </>
  );
}

/** Reprend le contenu d'une ancienne version, sans réécrire l'historique. */
export function RestoreVersionButton({
  articleId,
  version,
}: {
  articleId: string;
  version: number;
}) {
  const { pending, run } = useRunAction();
  return (
    <CompactButton
      variant="quiet"
      loading={pending}
      onClick={() => run(() => restoreArticleVersionAction(articleId, version))}
    >
      Reprendre ce contenu
    </CompactButton>
  );
}

/** En-tête d'un modèle : modifier, désactiver ou réactiver. */
export function TemplateHeaderActions({ template }: { template: TemplateRow }) {
  const { pending, run } = useRunAction();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        loading={pending}
        onClick={() => run(() => setTemplateActiveAction(template.id, !template.active))}
      >
        {template.active ? "Désactiver" : "Réactiver"}
      </Button>
      <Button variant="accent" onClick={() => setOpen(true)}>
        Modifier
      </Button>
      <TemplateDialog open={open} onClose={close} template={template} />
    </>
  );
}

/** Copie le texte d'un modèle : message récurrent à coller dans un échange. */
export function CopyTextButton({ text }: { text: string }) {
  const toast = useToast();
  return (
    <CompactButton
      variant="secondary"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => toast({ message: "Texte copié.", tone: "success" }))
          .catch(() => toast({ message: "La copie a échoué.", tone: "danger" }));
      }}
    >
      Copier le texte
    </CompactButton>
  );
}
