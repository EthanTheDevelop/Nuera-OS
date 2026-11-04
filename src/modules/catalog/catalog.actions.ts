"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { createCatalogItem, setCatalogItemActive, updateCatalogItem } from "./catalog.service";

export async function saveCatalogItemAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  const id = values.itemId;
  try {
    const ctx = await getServiceContext();
    if (id) await updateCatalogItem(ctx, id, values);
    else await createCatalogItem(ctx, values);
  } catch (error) {
    return toActionErrorState(error, { action: "catalog.save", values });
  }
  revalidatePath("/devis/catalogue", "layout");
  redirect("/devis/catalogue");
}

export async function setCatalogItemActiveAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  const active = values.active === "true";
  try {
    const ctx = await getServiceContext();
    await setCatalogItemActive(ctx, values.itemId ?? "", active);
  } catch (error) {
    return toActionErrorState(error, { action: "catalog.set_active", values });
  }
  revalidatePath("/devis/catalogue", "layout");
  return {
    status: "success",
    message: active ? "Prestation remise en vente." : "Prestation retirée de la vente.",
  };
}
