import type { KanbanTone } from "@/components/ui/kanban";
import { daysFromNow, formatDateShort } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { OpportunityStage } from "@/lib/domain-enums";
import type { OpportunityView } from "../opportunity.service";

/** Point de colonne (écran 03) : bleu tant que rien n'est parti, ambre en attente, vert une fois signé. */
export const STAGE_TONES: Record<OpportunityStage, KanbanTone> = {
  NEW: "accent",
  QUALIFIED: "accent",
  QUOTE_SENT: "warn",
  NEGOTIATION: "warn",
  WON: "success",
  LOST: "danger",
};

/** Seuil de la pastille « Sans activité » : 03.03.03. Modifiable dans le panneau Filtrer. */
export const INACTIVE_DEFAULT_DAYS = 14;
export const INACTIVE_OPTIONS = [7, 14, 30, 60] as const;

export function amountLabel(cents: number | null): string {
  return cents === null ? "Montant à définir" : formatCents(cents);
}

export function idleLabel(days: number): string {
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  return `${days} j`;
}

export interface CardSignal {
  label: string;
  tone: "warn" | "danger" | "muted";
}

/** Le repère de bas de carte : ce qui compte le plus à cette étape, sur une seule ligne. */
export function cardSignal(opportunity: OpportunityView, now = new Date()): CardSignal {
  if (opportunity.stage === "LOST") {
    return { label: opportunity.lostReason ?? "Motif non renseigné", tone: "danger" };
  }
  if (opportunity.stage === "WON") {
    return {
      label: opportunity.wonAt ? `Gagnée le ${formatDateShort(opportunity.wonAt)}` : "Gagnée",
      tone: "muted",
    };
  }
  if (opportunity.nextActionOn) {
    const inDays = daysFromNow(opportunity.nextActionOn, now);
    if (inDays !== null && inDays < 0) {
      return { label: `Relance J+${-inDays}`, tone: "warn" };
    }
    if (inDays === 0) return { label: "Relance aujourd'hui", tone: "warn" };
    return { label: `Relance ${formatDateShort(opportunity.nextActionOn)}`, tone: "muted" };
  }
  return { label: idleLabel(opportunity.idleDays), tone: "muted" };
}
