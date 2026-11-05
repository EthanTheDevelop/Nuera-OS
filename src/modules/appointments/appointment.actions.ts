"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import {
  changeAppointmentStatus,
  createAppointment,
  getCompanyLinkOptions,
  searchAppointmentCompanies,
  updateAppointment,
} from "./appointment.service";

/** `name` répété dans un formulaire : `formDataToObject` n'en garde qu'un. */
function readInput(formData: FormData) {
  const values = formDataToObject(formData);
  return {
    values,
    input: {
      title: values.title ?? "",
      kind: values.kind,
      startsAt: values.startsAt ?? "",
      durationMinutes: values.durationMinutes ?? "",
      channel: values.channel,
      location: values.location,
      companyId: values.companyId,
      contactId: values.contactId,
      projectId: values.projectId,
      opportunityId: values.opportunityId,
      memberIds: formData.getAll("memberIds").map(String),
      clientVisible: values.clientVisible,
    } as never,
  };
}

function refresh() {
  revalidatePath("/messages", "layout");
}

export async function saveAppointmentAction(
  appointmentId: string | null,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { values, input } = readInput(formData);
  try {
    const ctx = await getServiceContext();
    if (appointmentId) await updateAppointment(ctx, appointmentId, input);
    else {
      await createAppointment(ctx, {
        ...(input as object),
        clientRequestId: values.clientRequestId,
      } as never);
    }
  } catch (error) {
    return toActionErrorState(error, { action: "appointment.save", values });
  }
  refresh();
  return {
    status: "success",
    message: appointmentId ? "Rendez-vous modifié." : "Rendez-vous créé.",
  };
}

export async function changeAppointmentStatusAction(
  appointmentId: string,
  status: "planned" | "done" | "cancelled",
): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await changeAppointmentStatus(ctx, appointmentId, status);
  } catch (error) {
    return toActionErrorState(error, { action: "appointment.status" });
  }
  refresh();
  return { status: "success", message: "Rendez-vous mis à jour." };
}

export async function searchAppointmentCompaniesAction(search: string) {
  const ctx = await getServiceContext();
  return searchAppointmentCompanies(ctx, search);
}

export async function loadAppointmentLinksAction(companyId: string) {
  const ctx = await getServiceContext();
  return getCompanyLinkOptions(ctx, companyId);
}
