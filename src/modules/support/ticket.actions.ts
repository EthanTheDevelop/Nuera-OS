"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import {
  addTicketComment,
  addTicketMessage,
  archiveTicket,
  assignTicket,
  convertTicket,
  createTicket,
  getCompanyTargets,
  logTicketTime,
  refreshTicketCoverage,
  transitionTicket,
  updateTicket,
} from "./ticket.service";
import type {
  AddTicketCommentInput,
  AssignTicketInput,
  ConvertTicketInput,
  CreateTicketInput,
  LogTicketTimeInput,
  TransitionTicketInput,
  UpdateTicketInput,
} from "./ticket.schema";

const SUPPORT_PATH = "/support";

export type TicketActionState = ActionState & { ticketId?: string };

function succeed(message: string, ticketId?: string): TicketActionState {
  revalidatePath(SUPPORT_PATH);
  return { status: "success", message, ticketId };
}

export async function createTicketAction(
  _previous: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const values = formDataToObject(formData);
  try {
    const ticket = await createTicket(await getServiceContext(), values as CreateTicketInput);
    return succeed(`Demande ${ticket.number} créée.`, ticket.id);
  } catch (error) {
    return toActionErrorState(error, { action: "support.create", values });
  }
}

export async function updateTicketAction(
  _previous: TicketActionState,
  formData: FormData,
): Promise<TicketActionState> {
  const values = formDataToObject(formData);
  try {
    const ticket = await updateTicket(await getServiceContext(), values as UpdateTicketInput);
    return succeed("Demande enregistrée.", ticket.id);
  } catch (error) {
    return toActionErrorState(error, { action: "support.update", values });
  }
}

/** Changement d'état, depuis le glisser-déposer du tableau ou un bouton de la fenêtre. */
export async function transitionTicketAction(input: TransitionTicketInput): Promise<ActionState> {
  try {
    const ticket = await transitionTicket(await getServiceContext(), input);
    return succeed(`Demande ${ticket.number} mise à jour.`);
  } catch (error) {
    return toActionErrorState(error, { action: "support.transition" });
  }
}

export async function assignTicketAction(input: AssignTicketInput): Promise<ActionState> {
  try {
    await assignTicket(await getServiceContext(), input);
    return succeed("Responsable mis à jour.");
  } catch (error) {
    return toActionErrorState(error, { action: "support.assign" });
  }
}

export async function addTicketMessageAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await addTicketMessage(await getServiceContext(), {
      ticketId: values.ticketId ?? "",
      body: values.body ?? "",
      internal: values.internal === "on",
    });
    return succeed("Message enregistré.");
  } catch (error) {
    return toActionErrorState(error, { action: "support.message", values });
  }
}

export async function addTicketCommentAction(input: AddTicketCommentInput): Promise<ActionState> {
  try {
    await addTicketComment(await getServiceContext(), input);
    return succeed("Commentaire ajouté.");
  } catch (error) {
    return toActionErrorState(error, { action: "support.comment" });
  }
}

export async function logTicketTimeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await logTicketTime(await getServiceContext(), {
      ...values,
      billable: values.billable === "on",
    } as LogTicketTimeInput);
    return succeed("Temps enregistré.");
  } catch (error) {
    return toActionErrorState(error, { action: "support.time", values });
  }
}

export async function convertTicketAction(input: ConvertTicketInput): Promise<ActionState> {
  try {
    await convertTicket(await getServiceContext(), input);
    return succeed(
      input.target === "quote" ? "Devis créé et rattaché." : "Demande de changement créée.",
    );
  } catch (error) {
    return toActionErrorState(error, { action: "support.convert" });
  }
}

export async function refreshCoverageAction(ticketId: string): Promise<ActionState> {
  try {
    await refreshTicketCoverage(await getServiceContext(), ticketId);
    return succeed("Couverture recalculée.");
  } catch (error) {
    return toActionErrorState(error, { action: "support.coverage" });
  }
}

export async function archiveTicketAction(ticketId: string): Promise<ActionState> {
  try {
    await archiveTicket(await getServiceContext(), ticketId);
    return succeed("Demande archivée.");
  } catch (error) {
    return toActionErrorState(error, { action: "support.archive" });
  }
}

export interface CompanyTargetOptions {
  sites: { id: string; name: string; domain: string | null }[];
  contracts: { id: string; number: string; name: string }[];
  projects: { id: string; number: string; name: string }[];
}

/** Sites, contrats et projets du client choisi dans le formulaire. */
export async function loadCompanyTargetsAction(
  companyId: string,
): Promise<CompanyTargetOptions | null> {
  try {
    return await getCompanyTargets(await getServiceContext(), companyId);
  } catch (error) {
    toActionErrorState(error, { action: "support.targets" });
    return null;
  }
}

export type { CreateTicketInput };
