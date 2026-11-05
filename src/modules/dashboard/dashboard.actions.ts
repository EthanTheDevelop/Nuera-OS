"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { saveDashboardLayout } from "./dashboard.service";
import { globalSearch, type SearchGroup } from "./search.service";

export async function saveDashboardLayoutAction(layout: unknown): Promise<ActionState> {
  try {
    await saveDashboardLayout(await getServiceContext(), layout);
    revalidatePath("/");
    return { status: "success", message: "Tableau enregistré." };
  } catch (error) {
    return toActionErrorState(error, { action: "dashboard.saveLayout" });
  }
}

/** Recherche globale, passée à `AppShell` par la zone agence. Une erreur reste côté palette. */
export async function globalSearchAction(query: string): Promise<SearchGroup[]> {
  return globalSearch(await getServiceContext(), query);
}
