"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import type { MissionStatus } from "@/lib/domain-enums";
import {
  addMemberAbsence,
  archiveTeamMember,
  createMission,
  createTeamMember,
  linkMemberToUser,
  removeMemberAbsence,
  restoreTeamMember,
  transitionMission,
  updateMission,
  updateTeamMember,
} from "./team.service";

function revalidateTeam(): void {
  revalidatePath("/equipe", "layout");
  // La capacité et les missions nourrissent aussi l'écran du temps.
  revalidatePath("/temps", "layout");
}

export async function saveMemberAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    if (values.id) {
      await updateTeamMember(ctx, values.id, values);
      revalidateTeam();
      return { status: "success", message: "Fiche enregistrée." };
    }
    const { created } = await createTeamMember(ctx, values);
    revalidateTeam();
    return {
      status: "success",
      message: created ? "Membre ajouté." : "Ce membre était déjà enregistré.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "team.saveMember", values });
  }
}

export async function archiveMemberAction(id: string): Promise<ActionState> {
  try {
    await archiveTeamMember(await getServiceContext(), id);
    revalidateTeam();
    return { status: "success", message: "Membre archivé." };
  } catch (error) {
    return toActionErrorState(error, { action: "team.archiveMember" });
  }
}

export async function restoreMemberAction(id: string): Promise<ActionState> {
  try {
    await restoreTeamMember(await getServiceContext(), id);
    revalidateTeam();
    return { status: "success", message: "Membre restauré." };
  } catch (error) {
    return toActionErrorState(error, { action: "team.restoreMember" });
  }
}

export async function addAbsenceAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const { created } = await addMemberAbsence(await getServiceContext(), values);
    revalidateTeam();
    return {
      status: "success",
      message: created ? "Absence ajoutée." : "Cette absence était déjà déclarée.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "team.addAbsence", values });
  }
}

export async function removeAbsenceAction(id: string): Promise<ActionState> {
  try {
    await removeMemberAbsence(await getServiceContext(), id);
    revalidateTeam();
    return { status: "success", message: "Absence retirée." };
  } catch (error) {
    return toActionErrorState(error, { action: "team.removeAbsence" });
  }
}

export async function linkUserAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await linkMemberToUser(await getServiceContext(), values.memberId ?? "", {
      userId: values.userId,
    });
    revalidateTeam();
    return {
      status: "success",
      message: values.userId ? "Compte relié." : "Compte détaché.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "team.linkUser", values });
  }
}

export async function saveMissionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    if (values.id) {
      await updateMission(ctx, values.id, values);
      revalidateTeam();
      return { status: "success", message: "Mission modifiée." };
    }
    const { created } = await createMission(ctx, values);
    revalidateTeam();
    return {
      status: "success",
      message: created ? "Mission affectée." : "Cette mission était déjà affectée.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "team.saveMission", values });
  }
}

export async function transitionMissionAction(
  id: string,
  status: MissionStatus,
  deliverableReceivedOn?: string,
): Promise<ActionState> {
  try {
    await transitionMission(await getServiceContext(), id, { status, deliverableReceivedOn });
    revalidateTeam();
    return { status: "success", message: "Mission mise à jour." };
  } catch (error) {
    return toActionErrorState(error, { action: "team.transitionMission" });
  }
}
