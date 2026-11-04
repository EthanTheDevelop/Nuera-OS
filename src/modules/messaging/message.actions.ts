"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import {
  getCompanyLinkOptions,
  searchAppointmentCompanies,
} from "@/modules/appointments/appointment.service";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { toThreadMessage, type ThreadMessage } from "./messaging.format";
import {
  archiveConversation,
  createConversation,
  listMessages,
  markConversationRead,
  restoreConversation,
  sendMessage,
} from "./message.service";
import type { SendMessageInput, SuggestionMode, SuggestionSettings } from "./messaging.schema";
import {
  applyReplySuggestion,
  dismissReplySuggestion,
  requestReplySuggestion,
  updateSuggestionSettings,
  type SuggestionView,
} from "./suggestion.service";

const INBOX = "/messages";

type Failure = { ok: false; message: string; fieldErrors?: Record<string, string[] | undefined> };
export type ActionResult<T extends object = object> = ({ ok: true } & T) | Failure;

function failure(error: unknown, action: string): Failure {
  const state = toActionErrorState(error, { action });
  return state.status === "error"
    ? { ok: false, message: state.message, fieldErrors: state.fieldErrors }
    : { ok: false, message: "Une erreur inattendue est survenue." };
}

export async function sendMessageAction(
  input: SendMessageInput,
): Promise<ActionResult<{ messageId: string }>> {
  try {
    const ctx = await getServiceContext();
    const message = await sendMessage(ctx, input);
    revalidatePath(INBOX, "layout");
    return { ok: true, messageId: message.id };
  } catch (error) {
    return failure(error, "message.send");
  }
}

export async function markReadAction(conversationId: string): Promise<void> {
  const ctx = await getServiceContext();
  if (await markConversationRead(ctx, conversationId)) revalidatePath(INBOX, "layout");
}

export async function archiveConversationAction(conversationId: string): Promise<ActionResult> {
  try {
    const ctx = await getServiceContext();
    await archiveConversation(ctx, conversationId);
  } catch (error) {
    return failure(error, "conversation.archive");
  }
  revalidatePath(INBOX, "layout");
  redirect(INBOX);
}

export async function restoreConversationAction(conversationId: string): Promise<ActionResult> {
  try {
    const ctx = await getServiceContext();
    await restoreConversation(ctx, conversationId);
    revalidatePath(INBOX, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error, "conversation.restore");
  }
}

export async function loadOlderMessagesAction(
  conversationId: string,
  before: { at: Date; id: string },
): Promise<ActionResult<{ items: ThreadMessage[]; hasMore: boolean }>> {
  try {
    const ctx = await getServiceContext();
    const result = await listMessages(ctx, conversationId, { before });
    const now = new Date();
    return {
      ok: true,
      items: result.items.map((item) => toThreadMessage(item, now)),
      hasMore: result.hasMore,
    };
  } catch (error) {
    return failure(error, "message.load_older");
  }
}

export async function createConversationAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  let id: string;
  try {
    const ctx = await getServiceContext();
    ({ id } = await createConversation(ctx, {
      companyId: values.companyId ?? "",
      contactId: values.contactId,
      projectId: values.projectId,
      subject: values.subject,
      firstMessage: values.firstMessage,
      firstDirection: values.firstDirection as "outbound" | "inbound" | "internal" | undefined,
      clientRequestId: values.clientRequestId,
    }));
  } catch (error) {
    return toActionErrorState(error, { action: "conversation.create", values });
  }
  revalidatePath(INBOX, "layout");
  redirect(`${INBOX}/${id}`);
}

/** Listes du formulaire : les droits sont revérifiés par le service à chaque appel. */
export async function searchCompaniesAction(search: string) {
  const ctx = await getServiceContext();
  return searchAppointmentCompanies(ctx, search);
}

export async function loadCompanyLinksAction(companyId: string) {
  const ctx = await getServiceContext();
  return getCompanyLinkOptions(ctx, companyId);
}

// --- Suggestions -------------------------------------------------------------------------------

export async function requestSuggestionAction(
  conversationId: string,
  mode: SuggestionMode,
): Promise<ActionResult<{ suggestion: SuggestionView }>> {
  try {
    const ctx = await getServiceContext();
    const suggestion = await requestReplySuggestion(ctx, { conversationId, mode });
    revalidatePath(INBOX, "layout");
    return { ok: true, suggestion };
  } catch (error) {
    // L'échec est enregistré par le service : la nouvelle ligne `failed` doit s'afficher.
    revalidatePath(INBOX, "layout");
    return failure(error, "suggestion.request");
  }
}

export async function applySuggestionAction(
  suggestionId: string,
): Promise<ActionResult<{ body: string }>> {
  try {
    const ctx = await getServiceContext();
    const { body } = await applyReplySuggestion(ctx, suggestionId);
    revalidatePath(INBOX, "layout");
    return { ok: true, body };
  } catch (error) {
    return failure(error, "suggestion.apply");
  }
}

export async function dismissSuggestionAction(suggestionId: string): Promise<ActionResult> {
  try {
    const ctx = await getServiceContext();
    await dismissReplySuggestion(ctx, suggestionId);
    revalidatePath(INBOX, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error, "suggestion.dismiss");
  }
}

export async function updateSuggestionSettingsAction(
  settings: SuggestionSettings,
): Promise<ActionResult> {
  try {
    const ctx = await getServiceContext();
    await updateSuggestionSettings(ctx, settings);
    revalidatePath(INBOX, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error, "suggestion.settings");
  }
}
