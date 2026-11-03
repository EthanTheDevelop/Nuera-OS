/**
 * État renvoyé par les Server Actions aux formulaires (`useActionState`).
 * Type partagé client/serveur : ne contient que des données sérialisables.
 */
export type ActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
      /** Valeurs soumises, pour réafficher le formulaire (React le réinitialise après une action). */
      values?: Record<string, string>;
    };

export const IDLE_ACTION_STATE: ActionState = { status: "idle" };

export function fieldError(state: ActionState, field: string): string | undefined {
  return state.status === "error" ? state.fieldErrors?.[field]?.[0] : undefined;
}

export function submittedValue(state: ActionState, field: string): string | undefined {
  return state.status === "error" ? state.values?.[field] : undefined;
}
