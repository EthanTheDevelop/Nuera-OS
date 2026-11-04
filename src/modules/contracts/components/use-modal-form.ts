"use client";

import { useActionState } from "react";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";

/**
 * Formulaire de fenêtre branché sur une Server Action : au succès, notification et fermeture. Une
 * erreur reste dans la fenêtre (`FormAlert`), la saisie est rétablie par les champs.
 *
 * La notification part de l'action et non d'un effet : une transition d'état peut retirer de la page
 * le bouton qui porte ce formulaire dans le même rendu, et son effet ne s'exécuterait jamais.
 */
export function useModalForm(
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>,
  onDone: () => void,
) {
  const toast = useToast();
  const [state, formAction] = useActionState(
    async (previous: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await action(previous, formData);
      if (result.status === "success") {
        toast({ message: result.message, tone: "success" });
        onDone();
      }
      return result;
    },
    IDLE_ACTION_STATE,
  );
  return { state, formAction };
}
