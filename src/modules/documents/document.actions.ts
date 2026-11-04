"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import type { DocumentStatus, DocumentVisibility } from "@/lib/domain-enums";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { logger } from "@/server/logger";
import {
  archiveDocument,
  listDocumentLinkOptions,
  restoreDocument,
  setDocumentStatus,
  setDocumentVisibility,
  setReferenceVersion,
  updateDocument,
} from "./document.service";
import type { CompanyLinkOptions } from "./document.types";

function revalidateDocument(id: string) {
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
}

/** Objets d'un client, chargés quand un formulaire change de client. `null` si refusé. */
export async function loadDocumentLinkOptionsAction(
  companyId: string,
): Promise<CompanyLinkOptions | null> {
  try {
    return await listDocumentLinkOptions(await getServiceContext(), companyId);
  } catch (error) {
    logger.info("documents.link_options_refused", { error });
    return null;
  }
}

export async function updateDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const document = await updateDocument(ctx, values as never);
    revalidateDocument(document.id);
    return { status: "success", message: "Document modifié." };
  } catch (error) {
    return toActionErrorState(error, { action: "documents.update", values });
  }
}

export async function setDocumentVisibilityAction(
  id: string,
  visibility: DocumentVisibility,
): Promise<ActionState> {
  try {
    await setDocumentVisibility(await getServiceContext(), { id, visibility });
    revalidateDocument(id);
    return {
      status: "success",
      message:
        visibility === "client" ? "Document partagé au client." : "Document repassé en interne.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "documents.visibility" });
  }
}

export async function setDocumentStatusAction(
  id: string,
  status: DocumentStatus,
): Promise<ActionState> {
  try {
    await setDocumentStatus(await getServiceContext(), { id, status });
    revalidateDocument(id);
    return { status: "success", message: "Statut du document modifié." };
  } catch (error) {
    return toActionErrorState(error, { action: "documents.status" });
  }
}

export async function setReferenceVersionAction(
  id: string,
  versionId: string,
): Promise<ActionState> {
  try {
    await setReferenceVersion(await getServiceContext(), { id, versionId });
    revalidateDocument(id);
    return { status: "success", message: "Version de référence modifiée." };
  } catch (error) {
    return toActionErrorState(error, { action: "documents.reference" });
  }
}

export async function archiveDocumentAction(id: string): Promise<ActionState> {
  try {
    await archiveDocument(await getServiceContext(), id);
    revalidateDocument(id);
    return { status: "success", message: "Document archivé." };
  } catch (error) {
    return toActionErrorState(error, { action: "documents.archive" });
  }
}

export async function restoreDocumentAction(id: string): Promise<ActionState> {
  try {
    await restoreDocument(await getServiceContext(), id);
    revalidateDocument(id);
    return { status: "success", message: "Document restauré." };
  } catch (error) {
    return toActionErrorState(error, { action: "documents.restore" });
  }
}
