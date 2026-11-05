import { recordAudit } from "@/modules/audit/audit.service";
import { getCompanyRef } from "@/modules/crm/company.lookup";
import { getContact, listContactsForCompany } from "@/modules/crm/contact.service";
import { enqueueEmail } from "@/modules/platform/email-outbox";
import { getEmailDelivery, type EmailDelivery } from "@/modules/platform/email-outbox.status";
import { z } from "@/lib/zod";
import { requireReadableProject } from "@/modules/projects/project.access";
import { getProjectForPortal, listProjectsForPortal } from "@/modules/projects/project.portal";
import { closeClientSessions, ensureClientAccount } from "@/modules/users/client-account.service";
import type { PortalLinkIssuer } from "@/server/auth/magic-link";
import { assertCan, can } from "@/server/auth/permissions";
import { getEnv } from "@/server/config/env";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { PortalMembership } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { buildInvitationEmail } from "./portal.email";
import { firstNameOf, joinNames } from "./portal.format";
import { loadProjectHome, type PortalProjectHome } from "./portal.service";
import * as repository from "./portal.repository";
import {
  inviteClientSchema,
  membershipIdSchema,
  type InviteClientInput,
  type MembershipIdInput,
} from "./portal.schema";

/**
 * Côté agence : inviter, renvoyer, copier un lien, révoquer. `PortalLinkIssuer` est injecté par
 * l'adaptateur (`portal-access.actions.ts`) ou un test, pour ne pas lier le service à l'instance
 * better-auth de l'application.
 */
export interface PortalAccessDeps {
  issueLink: PortalLinkIssuer;
  host?: string;
}

const invitationKey = (membership: Pick<PortalMembership, "id" | "invitedAt">): string =>
  `portal.invitation:${membership.id}:${membership.invitedAt.toISOString()}`;

async function queueInvitation(
  db: Database,
  deps: PortalAccessDeps,
  membership: PortalMembership,
  contact: { firstName: string; email: string },
): Promise<void> {
  const key = invitationKey(membership);
  // Déjà déposée : aucun second jeton ni second e-mail. Répéter l'invitation ne change rien.
  if (await getEmailDelivery(db, key)) return;

  const url = await deps.issueLink(contact.email);
  if (!url) throw new ConflictError("Cette adresse n'a pas d'accès valide à l'espace client.");

  const scope = { db, companyId: membership.companyId };
  const [project] = await listProjectsForPortal(scope, { limit: 1 });
  const detail = project ? await getProjectForPortal(scope, project.id) : null;
  const mail = buildInvitationEmail({
    firstName: contact.firstName,
    projectName: project?.name ?? null,
    interlocutors: joinNames(
      (detail?.interlocutors ?? []).map((person) => firstNameOf(person.fullName)),
    ),
    url,
    host: deps.host ?? new URL(getEnv().BETTER_AUTH_URL).host,
  });
  await enqueueEmail(db, {
    to: contact.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    template: "portal_invitation",
    dedupeKey: key,
  });
}

export interface PortalInvitationResult {
  membershipId: string;
  status: PortalMembership["status"];
  delivery: EmailDelivery | null;
  /** L'accès était déjà ouvert : aucun nouvel e-mail. */
  alreadyActive: boolean;
}

/**
 * Crée ou réutilise le compte client et son adhésion (`invited`), source du cloisonnement, puis dépose
 * l'e-mail C1 dans la boîte d'envoi. Idempotent : répéter ne crée ni compte, ni adhésion, ni e-mail.
 * Rien ici ne présente un dépôt comme un envoi : l'écran lit `delivery`.
 */
export async function inviteClientToPortal(
  ctx: ServiceContext,
  rawInput: InviteClientInput,
  deps: PortalAccessDeps,
): Promise<PortalInvitationResult> {
  assertCan(ctx.actor, "crm:update");
  const input = parseInput(inviteClientSchema, rawInput);

  const [contact, company] = await Promise.all([
    getContact(ctx, input.contactId),
    getCompanyRef(ctx.db, input.companyId),
  ]);
  if (!company || contact.companyId !== company.id) throw new NotFoundError("Contact introuvable.");
  if (company.archivedAt || contact.archivedAt) {
    throw new ConflictError("Restaurez cette fiche avant d'ouvrir son espace client.");
  }
  if (!contact.email) {
    const message = "Ce contact n'a pas d'adresse e-mail.";
    throw new ValidationError(message, { contactId: [message] });
  }
  const email = contact.email.trim().toLowerCase();

  const membership = await ctx.db.transaction(async (tx) => {
    const account = await ensureClientAccount(tx, { email, name: contact.fullName });
    const existing = await repository.findMembershipOfUser(tx, account.id);
    const live = await repository.findLiveMembershipOfContact(tx, contact.id);
    if (live && live.userId !== account.id) {
      throw new ConflictError(
        "Ce contact a déjà un accès avec une autre adresse. Révoquez-le d'abord.",
      );
    }
    if (existing && existing.status !== "revoked") {
      if (existing.contactId !== contact.id || existing.companyId !== company.id) {
        // Sans dire de quel client il s'agit : c'est l'information d'un autre compte.
        throw new ConflictError("Cette adresse e-mail a déjà un accès à un autre espace client.");
      }
      return existing;
    }
    if (existing) {
      const restored = await repository.updateMembership(tx, existing.id, {
        status: "invited",
        companyId: company.id,
        contactId: contact.id,
        invitedBy: ctx.actor.userId,
        invitedAt: new Date(),
      });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "portal.membership_restored",
        entityType: "portal_membership",
        entityId: restored.id,
        metadata: { companyId: company.id, contactId: contact.id },
      });
      return restored;
    }
    const created = await repository.insertMembership(tx, {
      userId: account.id,
      companyId: company.id,
      contactId: contact.id,
      status: "invited",
      invitedBy: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "portal.invitation_sent",
      entityType: "portal_membership",
      entityId: created.id,
      metadata: { companyId: company.id, contactId: contact.id, accountCreated: account.created },
    });
    return created;
  });

  if (membership.status === "invited") {
    await queueInvitation(ctx.db, deps, membership, { firstName: contact.firstName, email });
  }
  return {
    membershipId: membership.id,
    status: membership.status,
    delivery: await getEmailDelivery(ctx.db, invitationKey(membership)),
    alreadyActive: membership.status === "active",
  };
}

async function requireLiveMembership(db: Database, membershipId: string) {
  const membership = await repository.findMembership(db, membershipId);
  if (!membership) throw new NotFoundError("Accès introuvable.");
  if (membership.status === "revoked") {
    throw new ConflictError("Cet accès est révoqué. Invitez à nouveau ce contact.");
  }
  return membership;
}

/**
 * L'adhésion ouvre le compte d'une adresse précise. Si la fiche a changé d'adresse depuis, un lien
 * partirait vers la nouvelle et ouvrirait le compte qu'elle désigne, peut-être celui d'un autre client.
 */
async function requireContactOfAccount(
  ctx: ServiceContext,
  membership: PortalMembership,
): Promise<{ firstName: string; email: string }> {
  const contact = await getContact(ctx, membership.contactId);
  if (!contact.email) throw new ConflictError("Ce contact n'a plus d'adresse e-mail.");
  const email = contact.email.trim().toLowerCase();
  if ((await repository.findAccountEmail(ctx.db, membership.userId)) !== email) {
    throw new ConflictError(
      "L'adresse de ce contact a changé : retirez cet accès, puis invitez-le à nouveau.",
    );
  }
  return { firstName: contact.firstName, email };
}

/**
 * Nouvelle invitation pour un accès existant. Une invitation encore en attente d'envoi n'est pas
 * doublée : c'est la même, l'écran le dit.
 */
export async function resendPortalInvitation(
  ctx: ServiceContext,
  rawInput: MembershipIdInput,
  deps: PortalAccessDeps,
): Promise<PortalInvitationResult> {
  assertCan(ctx.actor, "crm:update");
  const { membershipId } = parseInput(membershipIdSchema, rawInput);
  const membership = await requireLiveMembership(ctx.db, membershipId);
  const contact = await requireContactOfAccount(ctx, membership);

  const current = await getEmailDelivery(ctx.db, invitationKey(membership));
  if (current?.status === "pending") {
    return { membershipId, status: membership.status, delivery: current, alreadyActive: false };
  }

  const updated = await ctx.db.transaction(async (tx) => {
    const row = await repository.updateMembership(tx, membershipId, {
      invitedAt: new Date(),
      invitedBy: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "portal.invitation_sent",
      entityType: "portal_membership",
      entityId: membershipId,
      metadata: { companyId: row.companyId, resend: true },
    });
    return row;
  });
  await queueInvitation(ctx.db, deps, updated, contact);
  return {
    membershipId,
    status: updated.status,
    delivery: await getEmailDelivery(ctx.db, invitationKey(updated)),
    alreadyActive: false,
  };
}

/**
 * Sans SMTP, un associé peut transmettre le lien lui-même. Réservé à `users:manage`, journalisé,
 * rendu une seule fois : il n'est ni stocké ni présenté comme envoyé.
 */
export async function issuePortalInvitationLink(
  ctx: ServiceContext,
  rawInput: MembershipIdInput,
  deps: PortalAccessDeps,
): Promise<{ url: string }> {
  assertCan(ctx.actor, "users:manage");
  const { membershipId } = parseInput(membershipIdSchema, rawInput);
  const membership = await requireLiveMembership(ctx.db, membershipId);
  const contact = await requireContactOfAccount(ctx, membership);
  const url = await deps.issueLink(contact.email);
  if (!url) throw new ConflictError("Cette adresse n'a pas d'accès valide à l'espace client.");
  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "portal.invitation_link_issued",
    entityType: "portal_membership",
    entityId: membershipId,
    metadata: { companyId: membership.companyId },
  });
  return { url };
}

/**
 * Retire l'accès, immédiatement : l'adhésion est relue à chaque requête, et les sessions comme les
 * liens encore valables disparaissent dans la même transaction. Sans cela, une réinvitation rendrait
 * valable un lien transmis avant la révocation. Répéter ne change rien.
 */
export async function revokePortalAccess(
  ctx: ServiceContext,
  rawInput: MembershipIdInput,
): Promise<void> {
  assertCan(ctx.actor, "crm:update");
  const { membershipId } = parseInput(membershipIdSchema, rawInput);
  const membership = await repository.findMembership(ctx.db, membershipId);
  if (!membership) throw new NotFoundError("Accès introuvable.");
  await ctx.db.transaction(async (tx) => {
    const revoked = await repository.revokeMembership(tx, membershipId);
    if (!revoked) return;
    await closeClientSessions(tx, membership.userId);
    const email = await repository.findAccountEmail(tx, membership.userId);
    if (email) await repository.deleteLoginLinks(tx, email);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "portal.membership_revoked",
      entityType: "portal_membership",
      entityId: membershipId,
      metadata: { companyId: membership.companyId, contactId: membership.contactId },
    });
  });
}

export interface PortalAccessRow {
  contactId: string;
  fullName: string;
  email: string | null;
  membership: {
    id: string;
    status: PortalMembership["status"];
    invitedAt: Date;
    lastSeenAt: Date | null;
    delivery: EmailDelivery | null;
  } | null;
}

export interface PortalAccessOverview {
  rows: PortalAccessRow[];
  canManage: boolean;
  canCopyLink: boolean;
}

/** Ligne « Espace client » de la fiche : l'état réel de chaque contact, e-mail compris. */
export async function getPortalAccessForCompany(
  ctx: ServiceContext,
  companyId: string,
): Promise<PortalAccessOverview> {
  assertCan(ctx.actor, "crm:read");
  const [contacts, memberships] = await Promise.all([
    listContactsForCompany(ctx, companyId, { limit: 50 }),
    repository.listMembershipsOfCompany(ctx.db, companyId),
  ]);
  const rows = await Promise.all(
    contacts.map(async (contact): Promise<PortalAccessRow> => {
      // La plus récente d'un contact : une ligne révoquée reste visible tant qu'aucune ne la suit.
      const membership = memberships.find((row) => row.contactId === contact.id);
      return {
        contactId: contact.id,
        fullName: contact.fullName,
        email: contact.email,
        membership: membership
          ? {
              id: membership.id,
              status: membership.status,
              invitedAt: membership.invitedAt,
              lastSeenAt: membership.lastSeenAt,
              delivery: await getEmailDelivery(ctx.db, invitationKey(membership)),
            }
          : null,
      };
    }),
  );
  return {
    rows,
    canManage: can(ctx.actor, "crm:update"),
    canCopyLink: can(ctx.actor, "users:manage"),
  };
}

/** Le « contact » de l'aperçu : aucun, il ne lit donc aucune conversation. */
const NO_CONTACT = "00000000-0000-0000-0000-000000000000";

/**
 * Contexte de lecture de l'aperçu agence : le client du projet, pour les lectures du portail
 * seulement. La page d'aperçu n'expose aucune action. Aucun rôle interne n'obtient un `PortalContext`
 * par une autre voie, et les routes de dépôt et d'envoi résolvent le leur depuis la session.
 */
export async function getAgencyPreviewScope(
  ctx: ServiceContext,
  projectId: string,
): Promise<PortalContext> {
  assertCan(ctx.actor, "projects:read");
  // Une adresse mal formée est un projet qui n'existe pas, pas une erreur de base.
  if (!z.uuid().safeParse(projectId).success) throw new NotFoundError("Projet introuvable.");
  const project = await requireReadableProject(ctx, projectId);
  return { db: ctx.db, actor: ctx.actor, companyId: project.companyId, contactId: NO_CONTACT };
}

/**
 * C3 tel que le client le voit, pour l'équipe. Le rôle reste celui de l'équipe : les paiements du
 * client sont des données financières, réservées à `finance:read`.
 */
export async function loadAgencyPreview(
  ctx: ServiceContext,
  projectId: string,
): Promise<PortalProjectHome> {
  const scope = await getAgencyPreviewScope(ctx, projectId);
  return loadProjectHome(scope, projectId, new Date(), {
    withPayments: can(ctx.actor, "finance:read"),
  });
}
