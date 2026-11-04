"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getServiceContext } from "@/server/auth/session";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { completeActivity, createActivity, updateActivity } from "./activity.service";
import { listCompanyOptions, listContactOptions } from "./company.lookup";
import {
  archiveCompany,
  createCompany,
  mergeCompanies,
  restoreCompany,
  restoreCompanyByTwentyId,
  updateCompany,
} from "./company.service";
import {
  archiveContact,
  createContact,
  mergeContacts,
  restoreContact,
  updateContact,
} from "./contact.service";
import type { CrmActionState } from "./crm.action-state";
import {
  previewCompanyImport,
  runCompanyImportBatch,
  type ImportBatchResult,
  type ImportPreview,
} from "./crm.import.service";
import { DuplicateRecordError } from "./crm.shared";
import { syncCrmNow } from "./crm.sync.service";
import { assertCanAny } from "@/server/auth/permissions";

function fail(error: unknown, action: string, values?: Record<string, string>): CrmActionState {
  const state = toActionErrorState(error, { action, values });
  return error instanceof DuplicateRecordError ? { ...state, duplicate: error.duplicate } : state;
}

function revalidateCrm(companyId?: string | null) {
  revalidatePath("/clients");
  revalidatePath("/clients/contacts");
  revalidatePath("/clients/doublons");
  revalidatePath("/pipeline");
  if (companyId) revalidatePath(`/clients/${companyId}`);
}

// --- Clients ----------------------------------------------------------------------------------

export async function createCompanyAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const company = await createCompany(await getServiceContext(), values);
    revalidateCrm();
    return { status: "success", message: `${company.name} a été créé.`, id: company.id };
  } catch (error) {
    return fail(error, "crm.createCompany", values);
  }
}

export async function updateCompanyAction(
  companyId: string,
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    await updateCompany(await getServiceContext(), companyId, values);
    revalidateCrm(companyId);
    return { status: "success", message: "Fiche enregistrée.", id: companyId };
  } catch (error) {
    return fail(error, "crm.updateCompany", values);
  }
}

export async function archiveCompanyAction(companyId: string): Promise<ActionState> {
  try {
    await archiveCompany(await getServiceContext(), companyId);
    revalidateCrm(companyId);
    return { status: "success", message: "Client archivé : son historique reste consultable." };
  } catch (error) {
    return fail(error, "crm.archiveCompany");
  }
}

export async function restoreCompanyAction(companyId: string): Promise<ActionState> {
  try {
    await restoreCompany(await getServiceContext(), companyId);
    revalidateCrm(companyId);
    return { status: "success", message: "Client restauré." };
  } catch (error) {
    return fail(error, "crm.restoreCompany");
  }
}

/** Fiche archivée signalée par un doublon, parfois connue de Twenty seulement. */
export async function restoreDuplicateCompanyAction(twentyId: string): Promise<CrmActionState> {
  try {
    const company = await restoreCompanyByTwentyId(await getServiceContext(), twentyId);
    revalidateCrm(company.id);
    return { status: "success", message: `${company.name} a été restauré.`, id: company.id };
  } catch (error) {
    return fail(error, "crm.restoreDuplicateCompany");
  }
}

export async function mergeCompaniesAction(input: {
  winnerId: string;
  loserId: string;
}): Promise<ActionState> {
  try {
    const company = await mergeCompanies(await getServiceContext(), input);
    revalidateCrm(company.id);
    revalidatePath(`/clients/${input.loserId}`);
    return { status: "success", message: `Fiches fusionnées dans ${company.name}.` };
  } catch (error) {
    return fail(error, "crm.mergeCompanies");
  }
}

// --- Contacts ---------------------------------------------------------------------------------

function contactInput(formData: FormData) {
  return { ...formDataToObject(formData), roles: formData.getAll("roles").map(String) };
}

export async function createContactAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const contact = await createContact(await getServiceContext(), contactInput(formData));
    revalidateCrm(contact.companyId);
    return { status: "success", message: "Contact ajouté.", id: contact.id };
  } catch (error) {
    return fail(error, "crm.createContact", values);
  }
}

export async function updateContactAction(
  contactId: string,
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const contact = await updateContact(await getServiceContext(), contactId, {
      ...contactInput(formData),
      // Une case décochée n'est pas envoyée par le navigateur.
      isPrimary: formData.get("isPrimary") === "on",
    });
    revalidateCrm(contact.companyId);
    revalidatePath(`/clients/contacts/${contactId}`);
    return { status: "success", message: "Contact enregistré.", id: contact.id };
  } catch (error) {
    return fail(error, "crm.updateContact", values);
  }
}

export async function archiveContactAction(contactId: string): Promise<ActionState> {
  try {
    const contact = await archiveContact(await getServiceContext(), contactId);
    revalidateCrm(contact.companyId);
    revalidatePath(`/clients/contacts/${contactId}`);
    return { status: "success", message: "Contact archivé." };
  } catch (error) {
    return fail(error, "crm.archiveContact");
  }
}

export async function restoreContactAction(contactId: string): Promise<ActionState> {
  try {
    const contact = await restoreContact(await getServiceContext(), contactId);
    revalidateCrm(contact.companyId);
    revalidatePath(`/clients/contacts/${contactId}`);
    return { status: "success", message: "Contact restauré." };
  } catch (error) {
    return fail(error, "crm.restoreContact");
  }
}

export async function mergeContactsAction(input: {
  winnerId: string;
  loserId: string;
}): Promise<ActionState> {
  try {
    const contact = await mergeContacts(await getServiceContext(), input);
    revalidateCrm(contact.companyId);
    return { status: "success", message: "Contacts fusionnés." };
  } catch (error) {
    return fail(error, "crm.mergeContacts");
  }
}

// --- Activités --------------------------------------------------------------------------------

export async function createActivityAction(
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const activity = await createActivity(await getServiceContext(), values);
    revalidateCrm(activity.companyId);
    if (activity.opportunityId) revalidatePath(`/pipeline/${activity.opportunityId}`);
    if (activity.contactId) revalidatePath(`/clients/contacts/${activity.contactId}`);
    const message =
      activity.kind === "task"
        ? "Tâche ajoutée."
        : activity.kind === "note"
          ? "Note ajoutée."
          : "Échange consigné.";
    return { status: "success", message, id: activity.id };
  } catch (error) {
    return fail(error, "crm.createActivity", values);
  }
}

export async function updateActivityAction(
  activityId: string,
  _previous: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  const values = formDataToObject(formData);
  try {
    const activity = await updateActivity(await getServiceContext(), activityId, values);
    revalidateCrm(activity.companyId);
    if (activity.opportunityId) revalidatePath(`/pipeline/${activity.opportunityId}`);
    return { status: "success", message: "Activité enregistrée.", id: activity.id };
  } catch (error) {
    return fail(error, "crm.updateActivity", values);
  }
}

export async function completeActivityAction(activityId: string): Promise<ActionState> {
  try {
    const activity = await completeActivity(await getServiceContext(), activityId);
    revalidateCrm(activity.companyId);
    if (activity.opportunityId) revalidatePath(`/pipeline/${activity.opportunityId}`);
    return { status: "success", message: "Tâche terminée." };
  } catch (error) {
    return fail(error, "crm.completeActivity");
  }
}

// --- Import -----------------------------------------------------------------------------------

export type ImportPreviewState =
  { status: "success"; preview: ImportPreview } | { status: "error"; message: string };

export async function previewImportAction(csv: string): Promise<ImportPreviewState> {
  try {
    const preview = await previewCompanyImport(await getServiceContext(), { csv });
    return { status: "success", preview };
  } catch (error) {
    const state = toActionErrorState(error, { action: "crm.previewImport" });
    return {
      status: "error",
      message: state.status === "error" ? state.message : "Aperçu impossible.",
    };
  }
}

export type ImportBatchState =
  ({ status: "success" } & ImportBatchResult) | { status: "error"; message: string };

export async function runImportBatchAction(input: {
  importId: string;
  csv: string;
  lines: number[];
}): Promise<ImportBatchState> {
  try {
    const result = await runCompanyImportBatch(await getServiceContext(), input);
    revalidateCrm();
    return { status: "success", ...result };
  } catch (error) {
    const state = toActionErrorState(error, { action: "crm.runImportBatch" });
    return {
      status: "error",
      message: state.status === "error" ? state.message : "Import interrompu.",
    };
  }
}

// --- Synchronisation et listes de choix -------------------------------------------------------

export async function syncCrmAction(): Promise<ActionState> {
  try {
    const result = await syncCrmNow(await getServiceContext());
    revalidateCrm();
    const warning = result.warnings[0];
    return {
      status: "success",
      message: warning ?? `Synchronisation terminée : ${result.items} fiche(s) mise(s) à jour.`,
    };
  } catch (error) {
    return fail(error, "crm.sync");
  }
}

export async function searchCompanyOptionsAction(search: string) {
  const ctx = await getServiceContext();
  assertCanAny(ctx.actor, ["crm:read", "sales:read"]);
  return listCompanyOptions(ctx.db, { search, limit: 20 });
}

export async function listContactOptionsAction(companyId: string) {
  const ctx = await getServiceContext();
  assertCanAny(ctx.actor, ["crm:read", "sales:read"]);
  return listContactOptions(ctx.db, companyId);
}
