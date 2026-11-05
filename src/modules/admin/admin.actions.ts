"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSmtpGateway } from "@/integrations/smtp";
import type { ActionState } from "@/lib/action-state";
import { kickEmailOutbox } from "@/modules/platform/email-outbox.kick";
import { setTwoFactorRequired, updateAgencyProfile } from "@/modules/platform/settings.service";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getAuth } from "@/server/auth/auth";
import { getEnrolmentServiceContext, getServiceContext } from "@/server/auth/session";
import { visibleNavigation } from "@/config/navigation";
import { canAny } from "@/server/auth/permissions";
import {
  changeUserRole,
  deactivateUser,
  inviteUser,
  reactivateUser,
  revokeUserSessions,
  sendAccessLink,
} from "./admin.service";
import {
  revokeAllMySessions,
  revokeMySession,
  updateProfile,
  updateTheme,
} from "./profile.service";

function revalidateAdmin() {
  revalidatePath("/administration");
  revalidatePath("/administration/journal");
}

function deps() {
  return { auth: getAuth(), smtpConfigured: getSmtpGateway().isConfigured };
}

export type InviteState = ActionState & { link?: string | null };

export async function inviteUserAction(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const invitation = await inviteUser(ctx, values, deps());
    revalidateAdmin();
    if (invitation.link) {
      return {
        status: "success",
        message: "Compte créé. Copiez le lien et transmettez-le à la personne.",
        link: invitation.link,
      };
    }
    kickEmailOutbox(ctx.db);
    return { status: "success", message: "Invitation envoyée par e-mail.", link: null };
  } catch (error) {
    return toActionErrorState(error, { action: "admin.invite", values });
  }
}

export async function sendAccessLinkAction(userId: string): Promise<InviteState> {
  try {
    const ctx = await getServiceContext();
    const result = await sendAccessLink(ctx, userId, deps());
    revalidateAdmin();
    if (result.link) {
      return {
        status: "success",
        message: "Lien créé. Copiez-le et transmettez-le.",
        link: result.link,
      };
    }
    kickEmailOutbox(ctx.db);
    return { status: "success", message: "Lien d'accès envoyé par e-mail.", link: null };
  } catch (error) {
    return toActionErrorState(error, { action: "admin.access_link" });
  }
}

export async function changeUserRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await changeUserRole(await getServiceContext(), values);
    revalidateAdmin();
    return { status: "success", message: "Rôle modifié." };
  } catch (error) {
    return toActionErrorState(error, { action: "admin.role", values });
  }
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    if (active) await reactivateUser(ctx, userId);
    else await deactivateUser(ctx, userId);
    revalidateAdmin();
    return {
      status: "success",
      message: active ? "Compte réactivé." : "Compte désactivé, sessions fermées.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "admin.active" });
  }
}

export async function revokeUserSessionsAction(userId: string): Promise<ActionState> {
  try {
    const revoked = await revokeUserSessions(await getServiceContext(), userId);
    revalidateAdmin();
    return {
      status: "success",
      message: revoked > 1 ? `${revoked} sessions fermées.` : "Session fermée.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "admin.revoke_sessions" });
  }
}

export async function setTwoFactorRequiredAction(required: boolean): Promise<ActionState> {
  try {
    await setTwoFactorRequired(await getServiceContext(), required);
    revalidateAdmin();
    return {
      status: "success",
      message: required
        ? "Double authentification exigée pour l'équipe."
        : "Double authentification facultative.",
    };
  } catch (error) {
    return toActionErrorState(error, { action: "admin.require_2fa" });
  }
}

export async function saveAgencyProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    await updateAgencyProfile(await getServiceContext(), values);
    revalidatePath("/reglages/agence");
    return { status: "success", message: "Fiche de l'agence enregistrée." };
  } catch (error) {
    return toActionErrorState(error, { action: "settings.agency", values });
  }
}

// --- Profil : ouvert même à qui doit encore activer sa double authentification ------------------

export async function saveProfileAction(input: unknown): Promise<ActionState> {
  try {
    const ctx = await getEnrolmentServiceContext();
    const allowedHomePaths = visibleNavigation((permissions) => canAny(ctx.actor, permissions))
      .flatMap((section) => section.items.map((item) => item.href))
      .concat("/");
    await updateProfile(ctx, input, { allowedHomePaths });
    revalidatePath("/profil");
    return { status: "success", message: "Préférences enregistrées." };
  } catch (error) {
    return toActionErrorState(error, { action: "profile.save" });
  }
}

export async function saveThemeAction(theme: unknown): Promise<ActionState> {
  try {
    await updateTheme(await getEnrolmentServiceContext(), theme);
    revalidatePath("/profil");
    return { status: "success", message: "Thème enregistré." };
  } catch (error) {
    return toActionErrorState(error, { action: "profile.save_theme" });
  }
}

export async function revokeMySessionAction(sessionId: string): Promise<ActionState> {
  try {
    await revokeMySession(await getEnrolmentServiceContext(), sessionId);
    revalidatePath("/profil");
    return { status: "success", message: "Session fermée." };
  } catch (error) {
    return toActionErrorState(error, { action: "profile.revoke_session" });
  }
}

export async function revokeAllMySessionsAction(): Promise<ActionState> {
  try {
    await revokeAllMySessions(await getEnrolmentServiceContext());
  } catch (error) {
    return toActionErrorState(error, { action: "profile.revoke_all" });
  }
  redirect("/login");
}
