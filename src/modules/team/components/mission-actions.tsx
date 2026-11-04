"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { MissionStatus } from "@/lib/domain-enums";
import { MISSION_ACTION_LABELS, MISSION_TRANSITIONS } from "../mission.status";
import { transitionMissionAction } from "../team.actions";

/** Boutons de la machine à états : seuls les passages permis depuis le statut courant existent. */
export function MissionActions({
  missionId,
  status,
  today,
}: {
  missionId: string;
  status: MissionStatus;
  today: string;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<MissionStatus | null>(null);
  const [receivedOn, setReceivedOn] = useState(today);

  async function apply(target: MissionStatus) {
    const result = await transitionMissionAction(
      missionId,
      target,
      target === "delivered" ? receivedOn : undefined,
    );
    if (result.status === "error") toast({ message: result.message, tone: "danger" });
    if (result.status === "success") toast({ message: result.message });
  }

  return (
    <div className="flex flex-wrap gap-3">
      {MISSION_TRANSITIONS[status].map((target) => (
        <Button
          key={target}
          variant={target === "delivered" || target === "in_progress" ? "accent" : "default"}
          disabled={pending}
          onClick={() => {
            if (target === "delivered" || target === "cancelled") setConfirm(target);
            else startTransition(() => apply(target));
          }}
        >
          {status === "delivered" && target === "in_progress"
            ? "Rouvrir la mission"
            : MISSION_ACTION_LABELS[target]}
        </Button>
      ))}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "delivered" ? "Marquer la mission livrée" : "Annuler cette mission ?"}
        description={
          confirm === "delivered"
            ? "La date de réception du livrable sera enregistrée."
            : "Elle sort de la charge et des missions ouvertes. Elle pourra être replanifiée."
        }
        confirmLabel={confirm === "delivered" ? "Livrée" : "Annuler la mission"}
        cancelLabel="Fermer"
        tone={confirm === "cancelled" ? "danger" : "default"}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) await apply(confirm);
          setConfirm(null);
        }}
      >
        {confirm === "delivered" ? (
          <Field id="mission-received-on" label="Livrable reçu le">
            <Input
              id="mission-received-on"
              type="date"
              value={receivedOn}
              max={today}
              onChange={(event) => setReceivedOn(event.target.value)}
            />
          </Field>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
