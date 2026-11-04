"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import type { CrmActionState } from "@/modules/crm/crm.action-state";
import { DuplicateRecordError } from "@/modules/crm/crm.shared";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import {
  archiveOpportunity,
  createOpportunity,
  moveOpportunityStage,
  restoreOpportunity,
  setNextAction,
  updateOpportunity,
} from "./opportunity.service";

function revalidateSales(id: string, companyId?: string | null) {
  revalidatePath("/pipeline");
  revalidatePath(`/pipeline/${id}`);
  revalidatePath("/clients");
  if (companyId) revalidatePath(`/clients/${companyId}`);
}

function fail(error: unknown, action: string, values?: Record<string, string>): CrmActionState {
  const state = toActionErrorState(error, { action, values });
  return error instanceof DuplicateRecordError ? { ...state, duplicate: error.duplicate } : state;
}

export async function createOpportunityAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const opportunity = await createOpportunity(await getServiceContext(), values);
    revalidateSales(opportunity.id, opportunity.companyId);
    return { status: "success", message: "Affaire créée.", id: opportunity.id };
  } catch (error) {
    return fail(error, "sales.createOpportunity", values);
  }
}

export async function updateOpportunityAction(
  opportunityId: string,
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const opportunity = await updateOpportunity(await getServiceContext(), opportunityId, values);
    revalidateSales(opportunity.id, opportunity.companyId);
    return { status: "success", message: "Affaire enregistrée.", id: opportunity.id };
  } catch (error) {
    return fail(error, "sales.updateOpportunity", values);
  }
}

export async function setNextActionAction(
  opportunityId: string,
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const opportunity = await setNextAction(await getServiceContext(), opportunityId, values);
    revalidateSales(opportunity.id, opportunity.companyId);
    return { status: "success", message: "Prochaine action enregistrée." };
  } catch (error) {
    return fail(error, "sales.setNextAction", values);
  }
}

/** Glisser-déposer et boutons d'étape. Le résultat suit le contrat `onMove` de `KanbanBoard`. */
export async function moveOpportunityAction(input: {
  opportunityId: string;
  toStage: string;
  lostReason?: string;
}): Promise<ActionState> {
  try {
    const opportunity = await moveOpportunityStage(await getServiceContext(), input);
    revalidateSales(opportunity.id, opportunity.companyId);
    return { status: "success", message: "Étape mise à jour." };
  } catch (error) {
    return fail(error, "sales.moveOpportunity");
  }
}

export async function archiveOpportunityAction(opportunityId: string): Promise<ActionState> {
  try {
    const opportunity = await archiveOpportunity(await getServiceContext(), opportunityId);
    revalidateSales(opportunity.id, opportunity.companyId);
    return { status: "success", message: "Affaire archivée." };
  } catch (error) {
    return fail(error, "sales.archiveOpportunity");
  }
}

export async function restoreOpportunityAction(opportunityId: string): Promise<ActionState> {
  try {
    const opportunity = await restoreOpportunity(await getServiceContext(), opportunityId);
    revalidateSales(opportunity.id, opportunity.companyId);
    return { status: "success", message: "Affaire restaurée." };
  } catch (error) {
    return fail(error, "sales.restoreOpportunity");
  }
}
