"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { ActionState } from "@/lib/action-state";
import {
  listPortalConversation,
  markPortalRead,
  sendPortalMessage,
} from "@/modules/messaging/message.service";
import { addPortalTicketMessage, createTicketFromPortal } from "@/modules/support/ticket.service";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getPortalContext } from "@/server/auth/session";
import { getEnv } from "@/server/config/env";
import { parseInput } from "@/server/validation";
import { SELECTED_PROJECT_COOKIE } from "./portal.page";
import { olderMessagesSchema } from "./portal.schema";
import {
  assertPortalProject,
  requestSiteChange,
  submitDeliverableReview,
  submitRequirementDocument,
  submitRequirementText,
  updatePortalProfile,
} from "./portal.service";

/**
 * Adaptateurs du portail. Le contexte vient toujours de la session et de `portal_memberships` : aucun
 * champ de formulaire ne porte de `companyId`.
 */
function done(message: string): ActionState {
  revalidatePath("/espace", "layout");
  return { status: "success", message };
}

export async function reviewDeliverableAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getPortalContext();
    const decision = values.decision === "validated" ? "validated" : "changes_requested";
    const { overIncludedRounds } = await submitDeliverableReview(ctx, {
      deliverableId: values.deliverableId ?? "",
      decision,
      comment: values.comment,
    });
    if (decision === "validated") return done("Merci, votre validation est enregistrée.");
    return done(
      overIncludedRounds
        ? "Vos retours sont bien reçus. Ce tour dépasse ceux inclus : nous revenons vers vous avec une proposition."
        : "Vos retours sont bien reçus. Nous revenons vers vous avec une nouvelle version.",
    );
  } catch (error) {
    return toActionErrorState(error, { action: "portal.review", values });
  }
}

export async function submitRequirementDocumentAction(input: {
  requirementId: string;
  documentId: string;
}): Promise<ActionState> {
  try {
    await submitRequirementDocument(await getPortalContext(), input);
    return done("C'est bien reçu, merci.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.requirement_document" });
  }
}

export async function submitRequirementTextAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await submitRequirementText(await getPortalContext(), {
      requirementId: values.requirementId ?? "",
      text: values.text ?? "",
    });
    return done("C'est bien reçu, merci.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.requirement_text", values });
  }
}

export async function sendMessageAction(input: {
  body: string;
  documentId?: string | null;
  clientRequestId?: string;
}): Promise<ActionState> {
  try {
    await sendPortalMessage(await getPortalContext(), input);
    revalidatePath("/espace/messages");
    return { status: "success", message: "Message envoyé." };
  } catch (error) {
    return toActionErrorState(error, { action: "portal.message" });
  }
}

/** Le compteur de la capsule se relit à la suite. */
export async function markMessagesReadAction(): Promise<void> {
  await markPortalRead(await getPortalContext());
  revalidatePath("/espace", "layout");
}

export async function loadOlderMessagesAction(rawBefore: { at: Date; id: string }) {
  const before = parseInput(olderMessagesSchema, rawBefore);
  const { messages, hasMore } = await listPortalConversation(await getPortalContext(), { before });
  return { messages, hasMore };
}

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await updatePortalProfile(await getPortalContext(), {
      name: values.name ?? "",
      notifyMessage: values.notifyMessage === "on",
      notifyValidation: values.notifyValidation === "on",
      notifyInvoice: values.notifyInvoice === "on",
      notifyRequirement: values.notifyRequirement === "on",
      notifyReport: values.notifyReport === "on",
    });
    return done("Vos informations sont enregistrées.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.profile", values });
  }
}

export type TicketActionResult = ActionState & { ticketId?: string };

export async function openTicketAction(
  _previous: TicketActionResult,
  formData: FormData,
): Promise<TicketActionResult> {
  const values = formDataToObject(formData);
  try {
    const ticket = await createTicketFromPortal(await getPortalContext(), {
      subject: values.subject ?? "",
      description: values.description || undefined,
      category: (values.category || "assistance") as "assistance",
      siteId: values.siteId || undefined,
    });
    revalidatePath("/espace", "layout");
    return { status: "success", message: "Votre demande est bien reçue.", ticketId: ticket.id };
  } catch (error) {
    return toActionErrorState(error, { action: "portal.ticket", values });
  }
}

export async function replyTicketAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await addPortalTicketMessage(await getPortalContext(), {
      ticketId: values.ticketId ?? "",
      body: values.body ?? "",
    });
    return done("Message envoyé.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.ticket_reply", values });
  }
}

export async function requestSiteChangeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await requestSiteChange(await getPortalContext(), {
      siteId: values.siteId ?? "",
      current: values.current ?? "",
      next: values.next ?? "",
    });
    return done("Votre demande est envoyée.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.site_change", values });
  }
}

/** Changer de projet : préférence d'affichage en cookie, relue et contrôlée à chaque requête. */
export async function selectProjectAction(projectId: string): Promise<ActionState> {
  try {
    await assertPortalProject(await getPortalContext(), projectId);
    const store = await cookies();
    store.set(SELECTED_PROJECT_COOKIE, projectId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/espace",
      secure: getEnv().BETTER_AUTH_URL.startsWith("https:"),
      maxAge: 60 * 60 * 24 * 90,
    });
    return done("Projet affiché.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.select_project" });
  }
}
