"use client";

import { useCallback, useRef, useState } from "react";
import {
  KanbanBoard,
  type KanbanColumnDef,
  type KanbanItem,
  type KanbanMove,
} from "@/components/ui/kanban";
import type { ActionState } from "@/lib/action-state";
import { OPPORTUNITY_STAGES, type OpportunityStage } from "@/lib/domain-enums";
import { moveOpportunityAction } from "../opportunity.actions";
import { LostReasonDialog } from "./lost-reason-dialog";

function isStage(value: string): value is OpportunityStage {
  return (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

/** Refus silencieux : la carte reprend sa place, sans message d'erreur. */
const REVERT: ActionState = { status: "error", message: "" };

/**
 * Kanban de l'écran 03. La pose appelle la Server Action `moveOpportunityAction`, qui passe par la
 * machine à états et par Twenty : un refus ou un CRM coupé remet la carte en place avec le message.
 */
export function PipelineBoard({
  columns,
  items,
  names,
}: {
  columns: readonly KanbanColumnDef[];
  items: readonly KanbanItem[];
  /** Nom de chaque affaire, repris dans la fenêtre du motif de perte. */
  names: Readonly<Record<string, string>>;
}) {
  const [losing, setLosing] = useState<{ id: string; name: string } | null>(null);
  const settle = useRef<((result: ActionState) => void) | null>(null);

  const onMove = useCallback(
    async ({ itemId, toColumnId }: KanbanMove): Promise<ActionState> => {
      const from = items.find((item) => item.id === itemId);
      // L'ordre dans une colonne n'est pas conservé : rien à écrire, la carte revient.
      if (!from || from.columnId === toColumnId || !isStage(toColumnId)) return REVERT;
      if (toColumnId === "LOST") {
        return new Promise<ActionState>((resolve) => {
          settle.current = resolve;
          setLosing({ id: itemId, name: names[itemId] ?? from.label });
        });
      }
      return moveOpportunityAction({ opportunityId: itemId, toStage: toColumnId });
    },
    [items, names],
  );

  return (
    <>
      <KanbanBoard
        columns={columns}
        items={items}
        onMove={onMove}
        label="Affaires par étape"
        className="items-stretch lg:min-h-[640px]"
      />
      <LostReasonDialog
        opportunity={losing}
        onDone={(result) => {
          settle.current?.(result ?? REVERT);
          settle.current = null;
          setLosing(null);
        }}
      />
    </>
  );
}
