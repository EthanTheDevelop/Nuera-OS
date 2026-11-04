import {
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@/lib/domain-enums";
import type { Role } from "@/server/auth/roles";
import { ConflictError } from "@/server/errors";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

export { OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGES, type OpportunityStage };

/**
 * Étapes de l'affaire (§4) : on avance d'une étape à la fois, on peut revenir en arrière tant que
 * l'affaire n'est pas close. Une affaire peut être perdue à toute étape ouverte ; elle se gagne
 * dès le devis envoyé, sans passer par la négociation.
 */
export const OPPORTUNITY_TRANSITIONS: TransitionTable<OpportunityStage> = {
  NEW: ["QUALIFIED", "LOST"],
  QUALIFIED: ["NEW", "QUOTE_SENT", "LOST"],
  QUOTE_SENT: ["NEW", "QUALIFIED", "NEGOTIATION", "WON", "LOST"],
  NEGOTIATION: ["NEW", "QUALIFIED", "QUOTE_SENT", "WON", "LOST"],
  WON: [],
  LOST: [],
};

/** Réouverture d'une affaire close : réservée à `admin`. */
export const OPPORTUNITY_REOPEN_TRANSITIONS: TransitionTable<OpportunityStage> = {
  NEW: [],
  QUALIFIED: [],
  QUOTE_SENT: [],
  NEGOTIATION: [],
  WON: ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"],
  LOST: ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"],
};

export function isOpportunityClosed(stage: OpportunityStage): boolean {
  return stage === "WON" || stage === "LOST";
}

export function canOpportunityTransition(
  from: OpportunityStage,
  to: OpportunityStage,
  role: Role,
): boolean {
  if (canTransition(OPPORTUNITY_TRANSITIONS, from, to)) return true;
  return role === "admin" && canTransition(OPPORTUNITY_REOPEN_TRANSITIONS, from, to);
}

export interface OpportunityTransitionContext {
  role: Role;
  /** État de l'affaire APRÈS l'opération (une perte saisit son motif dans le même formulaire). */
  companyId?: string | null;
  amountCents?: number | null;
  lostReason?: string | null;
}

/** Applique les règles du §4 : transition autorisée, réouverture, motif de perte, client et montant. */
export function assertOpportunityTransition(
  from: OpportunityStage,
  to: OpportunityStage,
  context: OpportunityTransitionContext,
): void {
  if (canTransition(OPPORTUNITY_REOPEN_TRANSITIONS, from, to)) {
    if (context.role !== "admin") {
      throw new ConflictError("La réouverture d'une affaire close est réservée aux associés.");
    }
    return;
  }
  assertTransition(OPPORTUNITY_TRANSITIONS, from, to, OPPORTUNITY_STAGE_LABELS);
  if (to === "LOST" && !context.lostReason?.trim()) {
    throw new ConflictError("Indiquez le motif de perte.", {
      lostReason: ["Le motif de perte est obligatoire."],
    });
  }
  if (to === "WON") {
    const fieldErrors: Record<string, string[]> = {};
    if (!context.companyId) fieldErrors.companyId = ["Une affaire gagnée exige un client."];
    if (!context.amountCents || context.amountCents <= 0) {
      fieldErrors.amountCents = ["Une affaire gagnée exige un montant."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new ConflictError("Une affaire gagnée exige un client et un montant.", fieldErrors);
    }
  }
}
