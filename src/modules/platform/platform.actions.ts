"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { updateSuggestionSettings } from "@/modules/messaging/suggestion.service";
import { toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import {
  retryAutomationRun,
  retryFailedAutomationRuns,
  setAutomationRuleEnabled,
} from "./automation.service";
import { checkConnection } from "./connections.service";
import { markAllNotificationsRead } from "./notifications.service";

function revalidateAutomations() {
  revalidatePath("/automatisations");
  revalidatePath("/administration");
  revalidatePath("/administration/executions");
}

export async function setRuleEnabledAction(key: string, enabled: boolean): Promise<ActionState> {
  try {
    await setAutomationRuleEnabled(await getServiceContext(), { key, enabled });
    revalidateAutomations();
    return {
      status: "success",
      message: enabled ? "Automatisation activée." : "Automatisation désactivée.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "automations.toggle" });
  }
}

export async function retryRunAction(runId: string): Promise<ActionState> {
  try {
    const status = await retryAutomationRun(await getServiceContext(), runId);
    revalidateAutomations();
    return status === "failed"
      ? { status: "error", message: "Nouvel échec : l'erreur est dans la liste." }
      : { status: "success", message: "Exécution relancée, sans doublon." };
  } catch (error) {
    return toActionErrorState(error, { action: "automations.retry" });
  }
}

export async function retryFailedRunsAction(): Promise<ActionState> {
  try {
    const { retried, stillFailing } = await retryFailedAutomationRuns(await getServiceContext());
    revalidateAutomations();
    if (retried === 0) return { status: "success", message: "Aucune exécution à relancer." };
    return stillFailing > 0
      ? { status: "error", message: `${stillFailing} sur ${retried} encore en échec.` }
      : {
          status: "success",
          message:
            retried > 1 ? `${retried} relancées, sans doublon.` : "1 relancée, sans doublon.",
        };
  } catch (error) {
    return toActionErrorState(error, { action: "automations.retry_all" });
  }
}

const CHECK_MESSAGES: Record<string, string> = {
  connected: "Connexion vérifiée.",
  not_configured: "Connexion requise : ce service n'est pas configuré.",
};

export async function checkConnectionAction(service: string): Promise<ActionState> {
  try {
    const status = await checkConnection(await getServiceContext(), service);
    revalidatePath("/reglages/connexions");
    revalidatePath("/administration");
    const message = CHECK_MESSAGES[status];
    return message && status === "connected"
      ? { status: "success", message }
      : { status: "error", message: message ?? "Le service ne répond pas comme attendu." };
  } catch (error) {
    return toActionErrorState(error, { action: "connections.check" });
  }
}

export async function saveSuggestionSettingsAction(input: {
  enabled: boolean;
  readProjectContext: boolean;
}): Promise<ActionState> {
  try {
    await updateSuggestionSettings(await getServiceContext(), input);
    revalidatePath("/reglages/connexions");
    return { status: "success", message: "Réglage enregistré." };
  } catch (error) {
    return toActionErrorState(error, { action: "connections.suggestions" });
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionState> {
  try {
    await markAllNotificationsRead(await getServiceContext());
    revalidatePath("/profil/notifications");
    revalidatePath("/", "layout");
    return { status: "success", message: "Tout est marqué comme lu." };
  } catch (error) {
    return toActionErrorState(error, { action: "notifications.read_all" });
  }
}
