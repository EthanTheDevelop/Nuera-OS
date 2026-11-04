import type { SuggestionStatus } from "@/lib/domain-enums";
import { SUGGESTION_STATUS_LABELS } from "@/lib/domain-enums";
import { assertTransition, type TransitionTable } from "@/server/status-machine";

/**
 * Une suggestion prête est utilisée (elle remplit le champ, l'envoi reste humain, A10) ou écartée.
 * Un échec peut seulement être écarté : réessayer crée une nouvelle ligne, l'échec reste tracé.
 */
export const SUGGESTION_TRANSITIONS: TransitionTable<SuggestionStatus> = {
  ready: ["used", "dismissed"],
  used: [],
  dismissed: [],
  failed: ["dismissed"],
};

export function assertSuggestionTransition(from: SuggestionStatus, to: SuggestionStatus): void {
  assertTransition(SUGGESTION_TRANSITIONS, from, to, SUGGESTION_STATUS_LABELS);
}
