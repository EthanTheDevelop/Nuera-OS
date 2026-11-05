"use client";

import { useActionState } from "react";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";

/** Formulaire d'action : `onSuccess` suit la réussite, sans effet ni rendu en cascade. */
export function usePortalForm<State extends ActionState>(
  action: (previous: State, formData: FormData) => Promise<State>,
  onSuccess: (state: Extract<State, { status: "success" }>) => void,
) {
  return useActionState<State, FormData>(async (previous, formData) => {
    const next = await action(previous, formData);
    if (next.status === "success") onSuccess(next as Extract<State, { status: "success" }>);
    return next as Awaited<State>;
  }, IDLE_ACTION_STATE as Awaited<State>);
}
