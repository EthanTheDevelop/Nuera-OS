"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { FormAlert, TextareaField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { reviewDeliverableAction } from "../portal.actions";
import { usePortalForm } from "./use-portal-form";

/** « Je valide », « J'ai des retours » : la décision est écrite, et portée par une version. */
export function DeliverableReviewActions({
  deliverableId,
  title,
}: {
  deliverableId: string;
  title: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"validated" | "changes_requested" | null>(null);
  const [state, formAction] = usePortalForm(reviewDeliverableAction, (done) => {
    toast({ message: done.message, tone: "success" });
    setMode(null);
    router.refresh();
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <CompactButton icon="check" onClick={() => setMode("validated")}>
          Je valide
        </CompactButton>
        <CompactButton
          variant="secondary"
          icon="messages"
          onClick={() => setMode("changes_requested")}
        >
          J&apos;ai des retours
        </CompactButton>
      </div>
      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        width={560}
        title={mode === "validated" ? "Valider cette version" : "Vos retours"}
        description={title}
      >
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="deliverableId" value={deliverableId} />
          <input type="hidden" name="decision" value={mode ?? ""} />
          <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
          {mode === "changes_requested" ? (
            <TextareaField
              name="comment"
              label="Ce que vous souhaitez changer"
              state={state}
              rows={5}
              required
              autoFocus
            />
          ) : (
            <p className="text-sm text-muted">
              Votre validation est enregistrée pour cette version, et nous passons à la suite.
            </p>
          )}
          <div className="flex justify-end">
            <SubmitButton>
              {mode === "validated" ? "Je valide cette version" : "Envoyer mes retours"}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
