"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { createTemplate, setTemplateActive, updateTemplate } from "./template.service";

function revalidateTemplate(id?: string) {
  revalidatePath("/documents");
  revalidatePath("/documents/modeles");
  if (id) revalidatePath(`/documents/modeles/${id}`);
}

/** Crée le modèle, ou le modifie si le formulaire porte son identifiant. */
export async function saveTemplateAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const template = values.id
      ? await updateTemplate(ctx, values as never)
      : await createTemplate(ctx, values as never);
    revalidateTemplate(template.id);
    return { status: "success", message: values.id ? "Modèle modifié." : "Modèle créé." };
  } catch (error) {
    return toActionErrorState(error, { action: "templates.save", values });
  }
}

export async function setTemplateActiveAction(id: string, active: boolean): Promise<ActionState> {
  try {
    await setTemplateActive(await getServiceContext(), { id, active });
    revalidateTemplate(id);
    return { status: "success", message: active ? "Modèle réactivé." : "Modèle désactivé." };
  } catch (error) {
    return toActionErrorState(error, { action: "templates.active" });
  }
}
