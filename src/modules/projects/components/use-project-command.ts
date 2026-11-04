"use client";

import { useActionState, useCallback, useEffect, useRef, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";

/** Commande sans formulaire : notification du résultat, `pending` pendant l'appel. */
export function useCommand() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  /** Annonce le résultat. Vrai si l'action a réussi. */
  const announce = useCallback(
    (state: ActionState): boolean => {
      if (state.status === "success") toast({ message: state.message, tone: "success" });
      if (state.status === "error") toast({ message: state.message, tone: "danger" });
      return state.status === "success";
    },
    [toast],
  );

  const run = useCallback(
    (action: () => Promise<ActionState>, onSuccess?: () => void) => {
      startTransition(async () => {
        if (announce(await action())) onSuccess?.();
      });
    },
    [announce],
  );

  return { pending, run, announce };
}

/** Formulaire de fenêtre : au succès, notification et fermeture ; une erreur reste dans la fenêtre. */
export function useWindowForm(
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>,
  onDone: () => void,
) {
  const [state, formAction] = useActionState(action, IDLE_ACTION_STATE);
  const toast = useToast();
  const last = useRef<ActionState>(state);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.status === "success") {
      toast({ message: state.message, tone: "success" });
      onDone();
    }
  }, [state, toast, onDone]);

  return { state, formAction };
}
