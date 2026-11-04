"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDocusealGateway } from "@/integrations/docuseal";
import type { ActionState } from "@/lib/action-state";
import { getServiceContext } from "@/server/auth/session";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import type { ServiceContext } from "@/server/context";
import { refreshContractSignature, requestContractSignature } from "./contract-signature.service";
import {
  addContractNote,
  archiveContract,
  changeContractPrice,
  changeContractStatus,
  convertOverage,
  createContract,
  linkContractSite,
  renewContract,
  terminateContract,
  unlinkContractSite,
  updateContract,
  updateContractSignature,
} from "./contract.service";
import {
  completeIntervention,
  createIntervention,
  updateIntervention,
} from "./intervention.service";
import {
  createMaintenancePlan,
  setMaintenancePlanActive,
  updateMaintenancePlan,
} from "./maintenance-plan.service";

/** Adaptateurs : session → service → revalidation. Aucune règle métier ici. */
function revalidateContract(id: string): void {
  revalidatePath("/contrats");
  revalidatePath(`/contrats/${id}`);
}

async function run(
  action: string,
  formData: FormData,
  operation: (ctx: ServiceContext, values: Record<string, string>) => Promise<string>,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const message = await operation(ctx, values);
    return { status: "success", message };
  } catch (error) {
    return toActionErrorState(error, { action, values });
  }
}

export async function createContractAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  let id: string;
  try {
    const ctx = await getServiceContext();
    ({ id } = await createContract(ctx, values));
    revalidatePath("/contrats");
  } catch (error) {
    return toActionErrorState(error, { action: "contract.create", values });
  }
  redirect(`/contrats/${id}`);
}

export async function updateContractAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.update", formData, async (ctx, values) => {
    await updateContract(ctx, id, values);
    revalidateContract(id);
    return "Contrat enregistré.";
  });
}

export async function changeContractPriceAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.price", formData, async (ctx, values) => {
    await changeContractPrice(ctx, id, values);
    revalidateContract(id);
    return "Tarif révisé.";
  });
}

export async function renewContractAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.renew", formData, async (ctx, values) => {
    await renewContract(ctx, id, values);
    revalidateContract(id);
    return "Contrat renouvelé.";
  });
}

export async function changeContractStatusAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.status", formData, async (ctx, values) => {
    await changeContractStatus(ctx, id, values);
    revalidateContract(id);
    return "État du contrat modifié.";
  });
}

export async function terminateContractAction(
  id: string,
  input: { note: string; transfers: string; effectiveOn: string },
): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await terminateContract(ctx, id, input);
    revalidateContract(id);
    return { status: "success", message: "Contrat résilié." };
  } catch (error) {
    return toActionErrorState(error, { action: "contract.terminate" });
  }
}

export async function archiveContractAction(id: string): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await archiveContract(ctx, id);
    revalidatePath("/contrats");
  } catch (error) {
    return toActionErrorState(error, { action: "contract.archive" });
  }
  redirect("/contrats");
}

export async function addContractNoteAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.note", formData, async (ctx, values) => {
    await addContractNote(ctx, id, values);
    revalidateContract(id);
    return "Note ajoutée.";
  });
}

export async function updateContractSignatureAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.signature", formData, async (ctx, values) => {
    await updateContractSignature(ctx, id, values);
    revalidateContract(id);
    return "État de signature enregistré.";
  });
}

export async function requestContractSignatureAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.signature_request", formData, async (ctx, values) => {
    await requestContractSignature(ctx, id, values, { docuseal: getDocusealGateway() });
    revalidateContract(id);
    return "Contrat envoyé à la signature.";
  });
}

export async function refreshContractSignatureAction(id: string): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await refreshContractSignature(ctx, id, { docuseal: getDocusealGateway() });
    revalidateContract(id);
    return { status: "success", message: "État de signature relu chez DocuSeal." };
  } catch (error) {
    return toActionErrorState(error, { action: "contract.signature_refresh" });
  }
}

export async function linkContractSiteAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("contract.site_link", formData, async (ctx, values) => {
    await linkContractSite(ctx, id, values);
    revalidateContract(id);
    return "Site rattaché.";
  });
}

export async function unlinkContractSiteAction(id: string, siteId: string): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await unlinkContractSite(ctx, id, { siteId });
    revalidateContract(id);
    return { status: "success", message: "Site retiré du contrat." };
  } catch (error) {
    return toActionErrorState(error, { action: "contract.site_unlink" });
  }
}

export async function convertOverageAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  let quoteId: string | null;
  try {
    const ctx = await getServiceContext();
    ({ quoteId } = await convertOverage(ctx, id, values));
    revalidateContract(id);
  } catch (error) {
    return toActionErrorState(error, { action: "contract.overage", values });
  }
  if (quoteId) redirect(`/devis/${quoteId}`);
  return { status: "success", message: "Demande de changement créée." };
}

export async function createInterventionAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("intervention.create", formData, async (ctx, values) => {
    await createIntervention(ctx, id, values);
    revalidateContract(id);
    return "Intervention enregistrée.";
  });
}

export async function updateInterventionAction(
  id: string,
  interventionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("intervention.update", formData, async (ctx, values) => {
    await updateIntervention(ctx, id, interventionId, values);
    revalidateContract(id);
    return "Intervention modifiée.";
  });
}

export async function completeInterventionAction(
  id: string,
  interventionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("intervention.complete", formData, async (ctx, values) => {
    await completeIntervention(ctx, id, interventionId, values);
    revalidateContract(id);
    return "Intervention réalisée.";
  });
}

export async function createPlanAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("plan.create", formData, async (ctx, values) => {
    await createMaintenancePlan(ctx, values);
    revalidatePath("/contrats/formules");
    return "Formule créée.";
  });
}

export async function updatePlanAction(
  id: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run("plan.update", formData, async (ctx, values) => {
    await updateMaintenancePlan(ctx, id, values);
    revalidatePath("/contrats/formules");
    return "Formule enregistrée.";
  });
}

export async function setPlanActiveAction(id: string, active: boolean): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await setMaintenancePlanActive(ctx, id, active);
    revalidatePath("/contrats/formules");
    return {
      status: "success",
      message: active ? "Formule de nouveau proposée." : "Formule retirée.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "plan.active" });
  }
}
