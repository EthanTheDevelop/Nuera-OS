"use client";

import { useState } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ActionState } from "@/lib/action-state";
import { useCommand } from "./use-project-command";

/** Archive un élément ajouté par erreur. Un refus (quelque chose en dépend) s'annonce tel quel. */
export function ArchiveItemButton({
  subject,
  description,
  action,
  onDone,
}: {
  /** Nom de l'élément, repris dans le titre de la confirmation. */
  subject: string;
  description: string;
  action: () => Promise<ActionState>;
  onDone?: () => void;
}) {
  const { announce } = useCommand();
  const [open, setOpen] = useState(false);

  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Archiver
      </CompactButton>
      <ConfirmDialog
        open={open}
        title={`Archiver « ${subject} » ?`}
        description={description}
        confirmLabel="Archiver"
        cancelLabel="Garder"
        tone="danger"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const done = announce(await action());
          setOpen(false);
          if (done) onDone?.();
        }}
      />
    </>
  );
}
