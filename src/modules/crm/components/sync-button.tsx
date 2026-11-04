"use client";

import { useTransition } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { useToast } from "@/components/ui/toast";
import { syncCrmAction } from "../crm.actions";

/** Lance la réconciliation à la demande. Un échec le dit, sans simuler de succès. */
export function SyncButton() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <CompactButton
      variant="quiet"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await syncCrmAction();
          if (result.status === "success") toast({ message: result.message });
          if (result.status === "error") toast({ message: result.message, tone: "danger" });
        })
      }
    >
      Synchroniser
    </CompactButton>
  );
}
