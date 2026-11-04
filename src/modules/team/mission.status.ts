import type { BadgeTone } from "@/components/ui/badge";
import { MISSION_STATUS_LABELS, type MissionStatus } from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

/**
 * Parcours d'une mission : prévue → en cours → livrée. Une mission annulée peut être replanifiée,
 * une mission livrée rouverte si le livrable est refusé. Pas de saut direct de « prévue » à « livrée ».
 */
export const MISSION_TRANSITIONS: TransitionTable<MissionStatus> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["delivered", "planned", "cancelled"],
  delivered: ["in_progress"],
  cancelled: ["planned"],
};

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return canTransition(MISSION_TRANSITIONS, from, to);
}

export function assertMissionTransition(from: MissionStatus, to: MissionStatus): void {
  assertTransition(MISSION_TRANSITIONS, from, to, MISSION_STATUS_LABELS);
}

/** Libellés et tons de la colonne LIVRABLE (écran 22). */
export const MISSION_STATUS_BADGES: Record<MissionStatus, { label: string; tone: BadgeTone }> = {
  planned: { label: "À faire", tone: "neutral" },
  in_progress: { label: "En cours", tone: "accent" },
  delivered: { label: "Livrée", tone: "success" },
  cancelled: { label: "Annulée", tone: "neutral" },
};

/** Libellé du bouton qui mène à chaque statut. */
export const MISSION_ACTION_LABELS: Record<MissionStatus, string> = {
  planned: "Replanifier",
  in_progress: "Démarrer",
  delivered: "Marquer livrée",
  cancelled: "Annuler la mission",
};
