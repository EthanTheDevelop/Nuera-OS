"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getServiceContext } from "@/server/auth/session";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { isAppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { CompanyLinks } from "./finance.repository";
import * as finance from "./finance.service";
import {
  previewInvoiceImport,
  runInvoiceImport,
  type ImportPreview,
  type ImportResult,
} from "./import.service";

function revalidateFinance() {
  revalidatePath("/finances", "layout");
}

function success(message: string): ActionState {
  revalidateFinance();
  return { status: "success", message };
}

export async function createInvoiceAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await finance.createInvoiceReference(await getServiceContext(), values);
    return success("Référence de facture ajoutée.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.invoice.create", values });
  }
}

export async function updateInvoiceAction(
  id: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await finance.updateInvoiceReference(await getServiceContext(), id, values);
    return success("Référence de facture modifiée.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.invoice.update", values });
  }
}

export async function changeInvoiceStatusAction(
  id: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const updated = await finance.changeInvoiceStatus(await getServiceContext(), id, values);
    return success(
      updated.status === "paid"
        ? "Facture marquée payée."
        : updated.status === "cancelled"
          ? "Facture annulée."
          : "Encaissement annulé.",
    );
  } catch (error) {
    return toActionErrorState(error, { action: "finance.invoice.status", values });
  }
}

export async function setInvoiceVisibilityAction(
  id: string,
  visible: boolean,
): Promise<ActionState> {
  try {
    await finance.setInvoiceClientVisibility(await getServiceContext(), id, visible);
    return success(
      visible ? "Facture visible dans l'espace client." : "Facture masquée au client.",
    );
  } catch (error) {
    return toActionErrorState(error, { action: "finance.invoice.visibility" });
  }
}

export async function createScheduleItemAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await finance.createScheduleItem(await getServiceContext(), values);
    return success("Échéance ajoutée.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.schedule.create", values });
  }
}

export async function updateScheduleItemAction(
  id: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await finance.updateScheduleItem(await getServiceContext(), id, values);
    return success("Échéance modifiée.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.schedule.update", values });
  }
}

export async function deleteScheduleItemAction(id: string): Promise<ActionState> {
  try {
    await finance.deleteScheduleItem(await getServiceContext(), id);
    return success("Échéance retirée.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.schedule.delete" });
  }
}

export async function createDirectCostAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await finance.createDirectCost(await getServiceContext(), values);
    return success("Coût ajouté.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.cost.create", values });
  }
}

export async function updateDirectCostAction(
  id: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await finance.updateDirectCost(await getServiceContext(), id, values);
    return success("Coût modifié.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.cost.update", values });
  }
}

export async function deleteDirectCostAction(id: string): Promise<ActionState> {
  try {
    await finance.deleteDirectCost(await getServiceContext(), id);
    return success("Coût retiré.");
  } catch (error) {
    return toActionErrorState(error, { action: "finance.cost.delete" });
  }
}

/** Projets, contrats, échéances d'un client : recharge les listes d'un formulaire. */
export async function loadCompanyLinksAction(companyId: string): Promise<CompanyLinks | null> {
  try {
    return await finance.getCompanyLinks(await getServiceContext(), companyId);
  } catch (error) {
    logger.info("finance.links_rejected", { code: isAppError(error) ? error.code : "INTERNAL" });
    return null;
  }
}

export type ImportActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function readImportForm(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("Choisissez un fichier CSV.");
  }
  const rawMapping = formData.get("mapping");
  return {
    file: { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    mapping:
      typeof rawMapping === "string" && rawMapping
        ? (JSON.parse(rawMapping) as unknown)
        : undefined,
  };
}

function importFailure<T>(error: unknown, action: string): ImportActionResult<T> {
  if (isAppError(error)) return { ok: false, message: error.message };
  logger.error("action.failed", { action, error });
  return {
    ok: false,
    message: "Le fichier n'a pas pu être traité. Réessayez ou contactez un administrateur.",
  };
}

export async function previewImportAction(
  formData: FormData,
): Promise<ImportActionResult<ImportPreview>> {
  try {
    const { file, mapping } = await readImportForm(formData);
    return {
      ok: true,
      data: await previewInvoiceImport(await getServiceContext(), file, mapping),
    };
  } catch (error) {
    return importFailure(error, "finance.import.preview");
  }
}

export async function runImportAction(
  formData: FormData,
): Promise<ImportActionResult<ImportResult>> {
  try {
    const { file, mapping } = await readImportForm(formData);
    const result = await runInvoiceImport(await getServiceContext(), file, mapping);
    revalidateFinance();
    return { ok: true, data: result };
  } catch (error) {
    return importFailure(error, "finance.import.run");
  }
}
