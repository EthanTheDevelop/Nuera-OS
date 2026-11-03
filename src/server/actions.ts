import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { ConflictError, isAppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";

/** Champs jamais renvoyés au navigateur, même en cas d'erreur de formulaire. */
const NEVER_ECHOED = /pass(word)?|secret|token/i;

/** Convertit un `FormData` simple (champs texte) en objet, prêt pour la validation Zod. */
export function formDataToObject(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}

/**
 * Traduit une erreur en `ActionState` pour l'interface.
 * - Erreurs internes Next.js (redirect, notFound) : relancées.
 * - `AppError` : message destiné à l'utilisateur.
 * - Autres : journalisées, message générique (aucun détail technique exposé).
 */
export function toActionErrorState(
  error: unknown,
  context: { action: string; values?: Record<string, string> },
): ActionState {
  unstable_rethrow(error);

  const values = context.values
    ? Object.fromEntries(Object.entries(context.values).filter(([key]) => !NEVER_ECHOED.test(key)))
    : undefined;

  if (isAppError(error)) {
    logger.info("action.rejected", { action: context.action, code: error.code });
    const fieldErrors =
      error instanceof ValidationError || error instanceof ConflictError
        ? error.fieldErrors
        : undefined;
    return { status: "error", message: error.message, fieldErrors, values };
  }

  logger.error("action.failed", { action: context.action, error });
  return {
    status: "error",
    message: "Une erreur inattendue est survenue. Réessayez ou contactez un administrateur.",
    values,
  };
}
