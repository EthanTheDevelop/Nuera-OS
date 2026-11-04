"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import type { ActionState } from "@/lib/action-state";
import { OPPORTUNITY_STAGE_LABELS, type OpportunityStage } from "@/lib/domain-enums";
import { moveOpportunityAction } from "../opportunity.actions";
import { LostReasonDialog } from "./lost-reason-dialog";

/** Étapes permises, calculées par la page depuis la machine à états et le rôle. */
export function StageMenu({
  opportunity,
  nextStages,
}: {
  opportunity: { id: string; name: string };
  nextStages: readonly OpportunityStage[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [losing, setLosing] = useState(false);

  function notify(result: ActionState) {
    if (result.status === "success") toast({ message: result.message });
    if (result.status === "error") toast({ message: result.message, tone: "danger" });
  }

  if (nextStages.length === 0) return null;

  return (
    <>
      <Menu
        label="Changer d'étape"
        placement="bottom-end"
        items={nextStages.map((stage) => ({
          key: stage,
          label: OPPORTUNITY_STAGE_LABELS[stage],
          danger: stage === "LOST",
          separatorBefore: stage === "LOST",
          onSelect: () => {
            if (stage === "LOST") {
              setLosing(true);
              return;
            }
            startTransition(async () => {
              notify(
                await moveOpportunityAction({ opportunityId: opportunity.id, toStage: stage }),
              );
            });
          },
        }))}
        trigger={(props) => (
          <Button loading={pending} {...props}>
            Changer d&apos;étape
          </Button>
        )}
      />
      <LostReasonDialog
        opportunity={losing ? opportunity : null}
        onDone={(result) => {
          setLosing(false);
          if (result) notify(result);
        }}
      />
    </>
  );
}
