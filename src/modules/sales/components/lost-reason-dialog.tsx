"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Textarea } from "@/components/ui/form";
import { Modal, ModalRow } from "@/components/ui/modal";
import type { ActionState } from "@/lib/action-state";
import { moveOpportunityAction } from "../opportunity.actions";

/**
 * Une affaire ne se perd pas sans motif (03.04.03) : le déplacement n'est envoyé qu'une fois saisi.
 * `onDone` reçoit le résultat, ou `null` si l'utilisateur renonce : la carte reprend alors sa place.
 */
export function LostReasonDialog({
  opportunity,
  onDone,
}: {
  opportunity: { id: string; name: string } | null;
  onDone: (result: ActionState | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [pending, startTransition] = useTransition();

  const trimmed = reason.trim();
  const fieldError = touched && !trimmed ? "Le motif de perte est obligatoire." : undefined;

  function finish(result: ActionState | null) {
    setReason("");
    setError(null);
    setTouched(false);
    onDone(result);
  }

  function submit() {
    setTouched(true);
    if (!trimmed || !opportunity) return;
    startTransition(async () => {
      const result = await moveOpportunityAction({
        opportunityId: opportunity.id,
        toStage: "LOST",
        lostReason: trimmed,
      });
      if (result.status === "success") finish(result);
      else if (result.status === "error") setError(result.message);
    });
  }

  return (
    <Modal
      open={opportunity !== null}
      onClose={() => {
        if (!pending) finish(null);
      }}
      title={`Perdue : ${opportunity?.name ?? ""}`}
      description="Le motif nourrit l'analyse des ventes perdues. L'affaire reste consultable."
      width={520}
    >
      <form
        className="contents"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {error ? (
          <ModalRow>
            <Alert tone="danger">{error}</Alert>
          </ModalRow>
        ) : null}
        <ModalRow>
          <Field id="lost-reason" label="Motif de perte" error={fieldError}>
            <Textarea
              id="lost-reason"
              name="lostReason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
              required
              aria-invalid={fieldError ? true : undefined}
              placeholder="Budget trop court, a choisi un autre prestataire, projet reporté…"
              data-autofocus
            />
          </Field>
        </ModalRow>
        <ModalRow className="flex flex-wrap justify-end gap-3">
          <Button disabled={pending} onClick={() => finish(null)}>
            Annuler
          </Button>
          <Button type="submit" variant="accent" loading={pending}>
            Marquer perdue
          </Button>
        </ModalRow>
      </form>
    </Modal>
  );
}
