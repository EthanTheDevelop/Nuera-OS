"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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

/** Voile sur le bord droit tant qu'une colonne reste hors de vue : la ligne défile. */
function useMoreToTheRight(wrapper: RefObject<HTMLDivElement | null>): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const scroller = wrapper.current?.querySelector<HTMLElement>('[role="group"]');
    if (!scroller) return;
    const measure = () =>
      setMore(scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 4);
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [wrapper]);
  return more;
}

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
  const wrapper = useRef<HTMLDivElement>(null);
  const more = useMoreToTheRight(wrapper);

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
      <div ref={wrapper} className="relative">
        <KanbanBoard
          columns={columns}
          items={items}
          onMove={onMove}
          label="Affaires par étape"
          className="items-stretch lg:min-h-[max(640px,calc(100dvh-340px))]"
        />
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 right-0 bottom-4 w-14 bg-linear-to-l from-bg to-transparent transition-opacity duration-(--dur-fast) ${more ? "opacity-100" : "opacity-0"}`}
        />
      </div>
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
