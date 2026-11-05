"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { issuePortalLink } from "@/server/auth/portal-link";
import { toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import {
  inviteClientToPortal,
  issuePortalInvitationLink,
  resendPortalInvitation,
  revokePortalAccess,
  type PortalAccessDeps,
} from "./portal-access.service";

const deps: PortalAccessDeps = { issueLink: issuePortalLink };

function done(companyId: string, message: string): ActionState {
  revalidatePath(`/clients/${companyId}`);
  return { status: "success", message };
}

/** Le message dit ce qui s'est passé : une invitation déposée n'est pas une invitation envoyée. */
export async function invitePortalClientAction(input: {
  companyId: string;
  contactId: string;
}): Promise<ActionState> {
  try {
    const result = await inviteClientToPortal(await getServiceContext(), input, deps);
    return done(
      input.companyId,
      result.alreadyActive
        ? "Cet accès est déjà ouvert."
        : "Invitation en file d'envoi. Son état réel s'affiche ci-dessous.",
    );
  } catch (error) {
    return toActionErrorState(error, { action: "portal.invite" });
  }
}

export async function resendPortalInvitationAction(input: {
  companyId: string;
  membershipId: string;
}): Promise<ActionState> {
  try {
    await resendPortalInvitation(
      await getServiceContext(),
      { membershipId: input.membershipId },
      deps,
    );
    return done(input.companyId, "Nouvelle invitation en file d'envoi.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.resend" });
  }
}

export async function revokePortalAccessAction(input: {
  companyId: string;
  membershipId: string;
}): Promise<ActionState> {
  try {
    await revokePortalAccess(await getServiceContext(), { membershipId: input.membershipId });
    return done(input.companyId, "Accès retiré. Les sessions ouvertes sont fermées.");
  } catch (error) {
    return toActionErrorState(error, { action: "portal.revoke" });
  }
}

export type CopyLinkState = ActionState & { url?: string };

/** Rendu une seule fois à l'associé, jamais stocké ni journalisé en clair. */
export async function issuePortalLinkAction(input: {
  membershipId: string;
}): Promise<CopyLinkState> {
  try {
    const { url } = await issuePortalInvitationLink(
      await getServiceContext(),
      { membershipId: input.membershipId },
      deps,
    );
    return { status: "success", message: "Lien créé.", url };
  } catch (error) {
    return toActionErrorState(error, { action: "portal.copy_link" });
  }
}
