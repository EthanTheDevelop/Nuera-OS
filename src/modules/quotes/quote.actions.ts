"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDocusealGateway } from "@/integrations/docuseal";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";
import type { QuoteDeps } from "./quote.deps";
import {
  acceptQuoteManually,
  markQuoteSentManually,
  refreshQuoteSignature,
  sendQuoteForSignature,
} from "./quote-signature.service";
import {
  archiveQuote,
  createAmendment,
  createQuote,
  expireQuote,
  getOpportunityOptions,
  markQuoteNegotiation,
  refuseQuote,
  saveQuoteContent,
  updateQuoteReferences,
} from "./quote.service";

function deps(): QuoteDeps {
  return { docuseal: getDocusealGateway() };
}

function revalidateQuotes() {
  revalidatePath("/devis", "layout");
}

/** Identifiant du devis, porté par un champ caché du formulaire. */
function quoteIdOf(values: Record<string, string>): string {
  return values.quoteId ?? "";
}

/** Forme commune : une action de formulaire sur un devis, avec message de réussite. */
async function run(
  name: string,
  formData: FormData,
  operation: (values: Record<string, string>, quoteId: string) => Promise<string>,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const message = await operation(values, quoteIdOf(values));
    revalidateQuotes();
    return { status: "success", message };
  } catch (error) {
    return toActionErrorState(error, { action: name, values });
  }
}

export async function createQuoteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  let quoteId: string;
  try {
    const ctx = await getServiceContext();
    quoteId = (await createQuote(ctx, values)).id;
  } catch (error) {
    return toActionErrorState(error, { action: "quote.create", values });
  }
  revalidateQuotes();
  redirect(`/devis/${quoteId}/modifier`);
}

export async function createAmendmentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  let amendmentId: string;
  try {
    const ctx = await getServiceContext();
    amendmentId = (await createAmendment(ctx, quoteIdOf(values), values)).id;
  } catch (error) {
    return toActionErrorState(error, { action: "quote.amend", values });
  }
  revalidateQuotes();
  redirect(`/devis/${amendmentId}/modifier`);
}

export async function saveQuoteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  const quoteId = quoteIdOf(values);
  try {
    let lines: unknown;
    try {
      lines = JSON.parse(values.lines ?? "[]");
    } catch {
      throw new ValidationError("Les lignes du devis sont illisibles.");
    }
    const ctx = await getServiceContext();
    await saveQuoteContent(ctx, quoteId, { ...values, lines }, deps());
  } catch (error) {
    return toActionErrorState(error, { action: "quote.save", values });
  }
  revalidateQuotes();
  redirect(`/devis/${quoteId}`);
}

export async function sendForSignatureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.send_for_signature", formData, async (values, quoteId) => {
    const ctx = await getServiceContext();
    await sendQuoteForSignature(ctx, quoteId, values, deps());
    return "Demande de signature envoyée.";
  });
}

export async function markSentManuallyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.mark_sent", formData, async (_values, quoteId) => {
    const ctx = await getServiceContext();
    await markQuoteSentManually(ctx, quoteId);
    return "Devis marqué comme envoyé.";
  });
}

export async function checkSignatureAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.check_signature", formData, async (_values, quoteId) => {
    const ctx = await getServiceContext();
    const quote = await refreshQuoteSignature(ctx, quoteId, deps());
    return quote.signatureStatus === "signed"
      ? "Signature constatée : le devis est accepté."
      : quote.signatureStatus === "pending"
        ? "Toujours en attente de signature."
        : "L'état de la signature a été mis à jour.";
  });
}

export async function acceptManuallyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.accept_manual", formData, async (values, quoteId) => {
    const ctx = await getServiceContext();
    const { projectId } = await acceptQuoteManually(ctx, quoteId, values, deps());
    return projectId ? "Acceptation enregistrée : le projet est créé." : "Acceptation enregistrée.";
  });
}

export async function refuseQuoteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.refuse", formData, async (values, quoteId) => {
    const ctx = await getServiceContext();
    await refuseQuote(ctx, quoteId, values, deps());
    return "Refus enregistré.";
  });
}

export async function negotiationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.negotiation", formData, async (_values, quoteId) => {
    const ctx = await getServiceContext();
    await markQuoteNegotiation(ctx, quoteId);
    return "Devis passé en négociation.";
  });
}

export async function expireQuoteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.expire", formData, async (_values, quoteId) => {
    const ctx = await getServiceContext();
    await expireQuote(ctx, quoteId);
    return "Devis marqué comme expiré.";
  });
}

export async function updateReferencesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("quote.references", formData, async (values, quoteId) => {
    const ctx = await getServiceContext();
    await updateQuoteReferences(ctx, quoteId, values);
    return "Références enregistrées.";
  });
}

export async function archiveQuoteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    await archiveQuote(ctx, quoteIdOf(values));
  } catch (error) {
    return toActionErrorState(error, { action: "quote.archive", values });
  }
  revalidateQuotes();
  redirect("/devis");
}

/** Affaires d'un client, pour la fenêtre de création. */
export async function listOpportunityOptionsAction(
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  const ctx = await getServiceContext();
  return getOpportunityOptions(ctx, companyId);
}
