"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { simulateNewProject, type ProjectSimulation } from "./capacity.service";
import {
  createTimeEntry,
  deleteTimeEntry,
  listTaskOptionsForProject,
  saveTimesheetCell,
  updateTimeEntry,
} from "./time.service";

function revalidateTime(): void {
  revalidatePath("/temps", "layout");
  // Temps et capacité nourrissent aussi les cartes de l'équipe.
  revalidatePath("/equipe", "layout");
}

function formToEntry(values: Record<string, string>) {
  return {
    memberId: values.memberId,
    workOn: values.workOn,
    minutes: values.minutes,
    category: values.category,
    projectId: values.projectId,
    taskId: values.taskId,
    ticketId: values.ticketId,
    contractId: values.contractId,
    billable: values.billable === "on",
    note: values.note,
  };
}

export async function saveTimeEntryAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    if (values.id) {
      await updateTimeEntry(ctx, values.id, formToEntry(values));
      revalidateTime();
      return { status: "success", message: "Temps modifié." };
    }
    const { created } = await createTimeEntry(ctx, formToEntry(values));
    revalidateTime();
    return {
      status: "success",
      message: created ? "Temps enregistré." : "Ce temps était déjà enregistré.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "time.saveEntry", values });
  }
}

export async function deleteTimeEntryAction(id: string): Promise<ActionState> {
  try {
    await deleteTimeEntry(await getServiceContext(), id);
    revalidateTime();
    return { status: "success", message: "Temps supprimé." };
  } catch (error) {
    return toActionErrorState(error, { action: "time.deleteEntry" });
  }
}

export type CellResult =
  { status: "success"; minutes: number } | { status: "error"; message: string };

/** Cellule de feuille de temps, enregistrée à la sortie du champ. */
export async function saveTimesheetCellAction(input: unknown): Promise<CellResult> {
  try {
    const { minutes } = await saveTimesheetCell(await getServiceContext(), input);
    revalidateTime();
    return { status: "success", minutes };
  } catch (error) {
    const state = toActionErrorState(error, { action: "time.saveCell" });
    return {
      status: "error",
      message:
        state.status === "error"
          ? (state.fieldErrors?.minutes?.[0] ?? state.message)
          : "Enregistrement impossible.",
    };
  }
}

export type SimulationResult =
  { status: "success"; simulation: ProjectSimulation } | { status: "error"; message: string };

export async function simulateProjectAction(estimatedMinutes: number): Promise<SimulationResult> {
  try {
    const simulation = await simulateNewProject(await getServiceContext(), { estimatedMinutes });
    return { status: "success", simulation };
  } catch (error) {
    const state = toActionErrorState(error, { action: "time.simulate" });
    return {
      status: "error",
      message: state.status === "error" ? state.message : "Simulation impossible.",
    };
  }
}

export async function loadProjectTasksAction(
  projectId: string,
): Promise<{ id: string; label: string }[]> {
  try {
    return await listTaskOptionsForProject(await getServiceContext(), projectId);
  } catch (error) {
    toActionErrorState(error, { action: "time.loadTasks" });
    return [];
  }
}
