"use client";

import { useState } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatMinutes } from "@/lib/format";
import { deleteTimeEntryAction } from "../time.actions";
import type { TimeEntryOptions, TimeEntryView } from "../time.service";
import { TimeEntryEditButton } from "./time-entry-dialog";

/** Actions d'une ligne d'historique. `relative z-10` : au-dessus du lien de ligne. */
export function EntryRowActions({
  entry,
  options,
  today,
}: {
  entry: TimeEntryView;
  options: TimeEntryOptions;
  today: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  return (
    <span className="relative z-10 flex flex-wrap justify-end gap-3">
      <TimeEntryEditButton entry={entry} options={options} today={today} />
      <CompactButton variant="quiet" onClick={() => setConfirming(true)}>
        Supprimer
      </CompactButton>
      <ConfirmDialog
        open={confirming}
        title="Supprimer ce temps ?"
        description={`${formatMinutes(entry.minutes)} sortiront du coût réel et des totaux. La suppression reste au journal d'audit.`}
        confirmLabel="Supprimer"
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          const result = await deleteTimeEntryAction(entry.id);
          setConfirming(false);
          if (result.status === "error") toast({ message: result.message, tone: "danger" });
          if (result.status === "success") toast({ message: result.message });
        }}
      />
    </span>
  );
}
