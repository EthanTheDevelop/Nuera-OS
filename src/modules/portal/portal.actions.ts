"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import {
  listPortalConversation,
  markPortalRead,
  sendPortalMessage,
} from "@/modules/messaging/message.service";
import { addPortalTicketMessage } from "@/modules/support/ticket.service";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getEnv } from "@/server/config/env";
import { parseInput } from "@/server/validation";
import { completePortalGuide, dismissPortalTip, restartPortalGuide } from "./portal-guide.service";
import { requirePortalPage, SELECTED_PROJECT_COOKIE } from "./portal.page";
import { olderMessagesSchema, type PortalTipKey } from "./portal.schema";
import {
  assertPortalProject,
  openPortalTicket,
  requestSiteChange,
  submitDeliverableReview,
  submitRequirementDocument,
  submitRequirementText,
  updatePortalProfile,
} from "./portal.service";

/**
 * Adaptateurs du portail. Le contexte vient toujours de la session et de `portal_memberships` : aucun
 * champ de formulaire ne porte de `companyId`. `requirePortalPage` : un onglet resté ouvert après une
 * révocation mène à la page du client, jamais à la connexion de l'équipe.
 */
function done(message: string): ActionState {
  revalidatePath("/espace", "layout");
  return { status: "success", message };
}

/** Guide terminé ou écarté. Un échec n'arrête pas le client : le guide se reproposera. */
export async function completeGuideAction(): Promise<ActionState> {
  try {
    await completePortalGuide(await requirePortalPage());
    return done("Guide terminé.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.guide_complete" });
  }
}

/** Conseil fermé. L'interface l'a déjà retiré ; un échec le fera seulement revenir au prochain chargement. */
export async function dismissTipAction(tip: PortalTipKey): Promise<ActionState> {
  try {
    await dismissPortalTip(await requirePortalPage(), { tip });
    return done("Conseil fermé.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.tip_dismiss" });
  }
}

/** « Revoir le guide » : tout repart, depuis l'accueil. */
export async function restartGuideAction(): Promise<ActionState> {
  try {
    await restartPortalGuide(await requirePortalPage());
  } catch (error) {
    return toActionErrorState(error, { action: "portal.guide_restart" });
  }
  revalidatePath("/espace", "layout");
  redirect("/espace");
}

export async function reviewDeliverableAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await requirePortalPage();
    const decision = values.decision === "validated" ? "validated" : "changes_requested";
    const { overIncludedRounds } = await submitDeliverableReview(ctx, {
      deliverableId: values.deliverableId ?? "",
      decision,
      comment: values.comment,
      seen:
        values.projectId && values.version
          ? { projectId: values.projectId, version: Number(values.version) }
          : undefined,
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
    await submitRequirementDocument(await requirePortalPage(), input);
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
    await submitRequirementText(await requirePortalPage(), {
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
    await sendPortalMessage(await requirePortalPage(), input);
    revalidatePath("/espace/messages");
    return { status: "success", message: "Message envoyé." };
  } catch (error) {
    return toActionErrorState(error, { action: "portal.message" });
  }
}

/** Le compteur de la capsule se relit à la suite. */
export async function markMessagesReadAction(): Promise<void> {
  await markPortalRead(await requirePortalPage());
  revalidatePath("/espace", "layout");
}

export async function loadOlderMessagesAction(rawBefore: { at: Date; id: string }) {
  const before = parseInput(olderMessagesSchema, rawBefore);
  const { messages, hasMore } = await listPortalConversation(await requirePortalPage(), {
    before,
  });
  return { messages, hasMore };
}

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await updatePortalProfile(await requirePortalPage(), {
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
    const ticket = await openPortalTicket(await requirePortalPage(), {
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
    await addPortalTicketMessage(await requirePortalPage(), {
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
    await requestSiteChange(await requirePortalPage(), {
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
    await assertPortalProject(await requirePortalPage(), projectId);
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
