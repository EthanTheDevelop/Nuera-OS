import { randomBytes } from "node:crypto";
import { recordAudit } from "@/modules/audit/audit.service";
import { AUDIT_ACTIONS, type AuditAction } from "@/modules/audit/audit.constants";
import { enqueueEmail } from "@/modules/platform/email-outbox";
import { renderNotificationEmail } from "@/modules/platform/notifications.service";
import { getMemberIdForUser, getMembersByIds } from "@/modules/team/team.lookup";
import { assertKindMatchesRole } from "@/modules/team/team.service";
import type { MemberKind } from "@/lib/domain-enums";
import type { Auth } from "@/server/auth/auth";
import { PASSWORD_MAX_LENGTH } from "@/server/auth/password-policy";
import { assertCan, can, permissionsFor, type Permission } from "@/server/auth/permissions";
import { captureResetLink, extendResetLink } from "@/server/auth/reset-link";
import type { InternalRole, Role } from "@/server/auth/roles";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { z } from "@/lib/zod";
import * as repository from "./admin.repository";
import {
  auditQuerySchema,
  changeRoleSchema,
  inviteUserSchema,
  userQuerySchema,
} from "./admin.schema";

/** Comptes, rôles et journal (écran 24). Usurpation et suppression de compte n'existent pas. */
const INVITATION_VALIDITY_MS = 7 * 24 * 3_600_000;
const INVITATION_PATH = "/login/reinitialiser";

export interface AdminDeps {
  auth: Auth;
  /** SMTP configuré : le lien part par e-mail. Sinon : lien à usage unique, à transmettre. */
  smtpConfigured: boolean;
}

export async function listUsers(ctx: ServiceContext, rawQuery: unknown = {}) {
  assertCan(ctx.actor, "admin:read");
  const query = parseInput(userQuerySchema, rawQuery);
  const [items, total] = await Promise.all([
    repository.listUsers(ctx.db, {
      q: query.q,
      role: query.role,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }),
    repository.countUsers(ctx.db, { q: query.q, role: query.role }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

const LINK_LABEL = "Choisir mon mot de passe";

async function issueInvitationLink(auth: Auth, db: Database, email: string): Promise<string> {
  const link = await captureResetLink(() =>
    auth.api.requestPasswordReset({ body: { email, redirectTo: INVITATION_PATH } }),
  );
  if (!link) {
    throw new ConflictError(
      "Le lien n'a pas pu être créé. Le compte existe : réessayez avec « Envoyer un lien d'accès ».",
    );
  }
  await extendResetLink(db, link, new Date(Date.now() + INVITATION_VALIDITY_MS));
  return link;
}

export interface InvitationResult {
  userId: string;
  /** Lien à copier, une seule fois, quand aucun e-mail ne peut partir. */
  link: string | null;
}

function invitationMail(name: string, link: string) {
  return renderNotificationEmail({
    title: `Bienvenue sur Nuera OS, ${name}`,
    body: "Choisissez votre mot de passe pour accéder à Nuera OS. Ce lien reste valable 7 jours et ne sert qu'une fois.",
    url: link,
    linkLabel: LINK_LABEL,
  });
}

/**
 * Crée le compte avec un mot de passe aléatoire que personne ne connaît : la personne choisit le
 * sien par le lien, qui part par e-mail ou, sans SMTP, s'affiche une fois pour l'associé (journalisé).
 */
export async function inviteUser(
  ctx: ServiceContext,
  rawInput: unknown,
  deps: AdminDeps,
): Promise<InvitationResult> {
  assertCan(ctx.actor, "users:manage");
  const input = parseInput(inviteUserSchema, rawInput);
  if (await repository.emailExists(ctx.db, input.email)) {
    throw new ConflictError("Un compte existe déjà avec cette adresse e-mail.", {
      email: ["Adresse déjà utilisée."],
    });
  }

  const password = randomBytes(48).toString("base64url").slice(0, PASSWORD_MAX_LENGTH);
  const { user } = await deps.auth.api.createUser({
    body: { email: input.email, name: input.name, password, role: input.role },
  });
  // Le compte existe dès cet instant : il est journalisé avant toute étape qui pourrait échouer.
  // Si le lien échoue, « Envoyer un lien d'accès » reprend depuis la liste des comptes.
  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    metadata: {
      name: input.name,
      role: input.role,
      via: "invitation",
      delivery: deps.smtpConfigured ? "email" : "copy_link",
    },
  });
  const link = await issueInvitationLink(deps.auth, ctx.db, input.email);
  if (deps.smtpConfigured) {
    await enqueueEmail(ctx.db, {
      to: input.email,
      subject: "Votre accès à Nuera OS",
      ...invitationMail(input.name, link),
      template: "user_invitation",
      dedupeKey: `user_invitation:${user.id}`,
    });
  }
  return { userId: user.id, link: deps.smtpConfigured ? null : link };
}

/** Nouveau lien pour un compte de l'équipe : l'ancien reste valable jusqu'à son expiration. */
export async function sendAccessLink(
  ctx: ServiceContext,
  rawUserId: unknown,
  deps: AdminDeps,
): Promise<{ link: string | null }> {
  assertCan(ctx.actor, "users:manage");
  const id = parseInput(z.uuid(), rawUserId);
  const user = await repository.findUser(ctx.db, id);
  if (!user) throw new NotFoundError("Compte introuvable.");
  if (user.role === "client") {
    throw new ConflictError("Un client se connecte par un lien de son espace, sans mot de passe.");
  }
  if (user.banned) throw new ConflictError("Ce compte est désactivé.");

  const link = await issueInvitationLink(deps.auth, ctx.db, user.email);
  await ctx.db.transaction(async (tx) => {
    if (deps.smtpConfigured) {
      await enqueueEmail(tx, {
        to: user.email,
        subject: "Votre accès à Nuera OS",
        ...invitationMail(user.name, link),
        template: "user_invitation",
      });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user.password_reset",
      entityType: "user",
      entityId: user.id,
      metadata: {
        name: user.name,
        via: "admin_link",
        delivery: deps.smtpConfigured ? "email" : "copy_link",
      },
    });
  });
  return { link: deps.smtpConfigured ? null : link };
}

function assertNotLastAdmin(adminIds: readonly string[], userId: string): void {
  if (adminIds.length === 1 && adminIds[0] === userId) {
    throw new ConflictError(
      "C'est le dernier compte de direction actif : nommez-en un autre avant de le retirer.",
    );
  }
}

/** Le rôle suit la fiche d'équipe : même règle que le module Équipe. */
async function assertRoleFitsTeamMember(tx: Database, userId: string, role: Role): Promise<void> {
  const memberId = await getMemberIdForUser(tx, userId);
  if (!memberId) return;
  const [member] = await getMembersByIds(tx, [memberId]);
  if (member) assertKindMatchesRole(member.kind as MemberKind, role);
}

export async function changeUserRole(ctx: ServiceContext, rawInput: unknown): Promise<void> {
  assertCan(ctx.actor, "users:manage");
  const input = parseInput(changeRoleSchema, rawInput);
  await ctx.db.transaction(async (tx) => {
    const adminIds = await repository.lockActiveAdminIds(tx);
    const user = await repository.findUser(tx, input.userId);
    if (!user) throw new NotFoundError("Compte introuvable.");
    if (user.role === "client") {
      throw new ConflictError(
        "Un client garde son rôle : son accès passe par son adhésion au portail.",
      );
    }
    if (user.role === input.role) return;
    if (user.role === "admin") assertNotLastAdmin(adminIds, user.id);
    await assertRoleFitsTeamMember(tx, user.id, input.role);

    await repository.updateRole(tx, user.id, input.role);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user.role_changed",
      entityType: "user",
      entityId: user.id,
      metadata: { name: user.name, from: user.role, to: input.role },
    });
  });
}

/** Désactive et ferme toutes les sessions : effet immédiat. Répétable. Rien n'est supprimé. */
export async function deactivateUser(ctx: ServiceContext, rawUserId: unknown): Promise<void> {
  assertCan(ctx.actor, "users:manage");
  const id = parseInput(z.uuid(), rawUserId);
  if (id === ctx.actor.userId) {
    throw new ConflictError("Vous ne pouvez pas désactiver votre propre compte.");
  }
  await ctx.db.transaction(async (tx) => {
    const adminIds = await repository.lockActiveAdminIds(tx);
    const user = await repository.findUser(tx, id);
    if (!user) throw new NotFoundError("Compte introuvable.");
    if (user.banned) return;
    if (user.role === "admin") assertNotLastAdmin(adminIds, user.id);

    await repository.setBanned(tx, user.id, {
      banned: true,
      banReason: "Désactivé depuis l'administration.",
    });
    const revoked = await repository.deleteSessions(tx, user.id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user.banned",
      entityType: "user",
      entityId: user.id,
      metadata: { name: user.name, revoked },
    });
  });
}

export async function reactivateUser(ctx: ServiceContext, rawUserId: unknown): Promise<void> {
  assertCan(ctx.actor, "users:manage");
  const id = parseInput(z.uuid(), rawUserId);
  await ctx.db.transaction(async (tx) => {
    const user = await repository.findUser(tx, id);
    if (!user) throw new NotFoundError("Compte introuvable.");
    if (!user.banned) return;
    await repository.setBanned(tx, user.id, { banned: false, banReason: null });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user.unbanned",
      entityType: "user",
      entityId: user.id,
      metadata: { name: user.name },
    });
  });
}

export async function revokeUserSessions(ctx: ServiceContext, rawUserId: unknown): Promise<number> {
  assertCan(ctx.actor, "users:manage");
  const id = parseInput(z.uuid(), rawUserId);
  return ctx.db.transaction(async (tx) => {
    const user = await repository.findUser(tx, id);
    if (!user) throw new NotFoundError("Compte introuvable.");
    const revoked = await repository.deleteSessions(tx, user.id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user.sessions_revoked",
      entityType: "user",
      entityId: user.id,
      metadata: { name: user.name, revoked },
    });
    return revoked;
  });
}

// --- Matrice des permissions --------------------------------------------------------------------

/** Lignes de l'écran 24 : lues dans la matrice réelle, jamais recopiées. */
const PERMISSION_ROWS: readonly { label: string; any: readonly Permission[] }[] = [
  { label: "Voir les finances", any: ["finance:read"] },
  { label: "Déclencher un déploiement", any: ["deployments:trigger"] },
  { label: "Voir les projets et documents", any: ["projects:read", "projects:read_assigned"] },
  { label: "Ouvrir une demande", any: ["support:create"] },
  { label: "Voir les coûts des membres", any: ["team:read_costs"] },
  { label: "Gérer les automatisations", any: ["automations:manage"] },
  { label: "Modifier les rôles", any: ["users:manage"] },
  { label: "Exporter les données", any: ["export:run"] },
];

/** `client` est à part : il passe par le portail et ne voit que sa société. */
const CLIENT_CAN = new Set(["Voir les projets et documents", "Ouvrir une demande"]);

export const PERMISSION_COLUMNS: readonly (InternalRole | "client")[] = [
  "admin",
  "member",
  "contractor",
  "viewer",
  "client",
];

export function getPermissionMatrix(ctx: ServiceContext) {
  assertCan(ctx.actor, "admin:read");
  return PERMISSION_ROWS.map((row) => ({
    label: row.label,
    roles: Object.fromEntries(
      PERMISSION_COLUMNS.map((role) => [
        role,
        role === "client"
          ? CLIENT_CAN.has(row.label)
          : row.any.some((permission) => permissionsFor(role).includes(permission)),
      ]),
    ) as Record<InternalRole | "client", boolean>,
  }));
}

// --- Journal ------------------------------------------------------------------------------------

/** Actions de la carte « Actions sensibles » : ce qui change les droits, les données ou l'argent. */
const SENSITIVE_ACTIONS: readonly AuditAction[] = [
  "user.created",
  "user.role_changed",
  "user.banned",
  "user.unbanned",
  "user.password_reset",
  "user.sessions_revoked",
  "auth.two_factor_enabled",
  "auth.two_factor_disabled",
  "deployment.triggered",
  "export.run",
  "company.merged",
  "contact.merged",
  "contract.terminated",
  "app_setting.updated",
  "automation_rule.enabled",
  "automation_rule.disabled",
  "portal.membership_revoked",
];

export const AUDIT_GROUPS = [
  { key: "comptes", label: "Comptes", prefixes: ["user.", "auth."] },
  { key: "clients", label: "Clients", prefixes: ["company.", "contact.", "crm."] },
  { key: "ventes", label: "Ventes", prefixes: ["opportunity.", "quote.", "catalog_item."] },
  { key: "production", label: "Production", prefixes: ["project.", "task.", "deliverable."] },
  { key: "sites", label: "Sites", prefixes: ["site.", "deployment.", "domain."] },
  { key: "contrats", label: "Contrats", prefixes: ["contract.", "intervention."] },
  { key: "support", label: "Support", prefixes: ["ticket."] },
  {
    key: "finances",
    label: "Finances",
    prefixes: ["financial_document.", "finance.", "schedule_item.", "direct_cost."],
  },
  {
    key: "administration",
    label: "Administration",
    prefixes: ["automation_", "integration.", "app_setting.", "export."],
  },
] as const;

function actionsOfGroup(key: string): string[] | undefined {
  const group = AUDIT_GROUPS.find((candidate) => candidate.key === key);
  if (!group) return undefined;
  const prefixes: readonly string[] = group.prefixes;
  return Object.keys(AUDIT_ACTIONS).filter((action) =>
    prefixes.some((prefix) => action.startsWith(prefix)),
  );
}

function auditDetail(metadata: Record<string, unknown>): string | null {
  for (const key of ["name", "number", "title", "dataset", "key"]) {
    const value = metadata[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function toAuditView(row: Awaited<ReturnType<typeof repository.listAudit>>[number]) {
  const known = row.action in AUDIT_ACTIONS;
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    action: row.action,
    label: known ? AUDIT_ACTIONS[row.action as AuditAction] : row.action,
    detail: auditDetail(row.metadata),
    actorId: row.actorId,
    actorName: row.actorName,
    entityType: row.entityType,
  };
}

export type AuditEntryView = ReturnType<typeof toAuditView>;

export async function listAuditLog(ctx: ServiceContext, rawQuery: unknown = {}) {
  assertCan(ctx.actor, "audit:read");
  const query = parseInput(auditQuerySchema, rawQuery);
  const filters: repository.AuditFilters = {
    actions: query.action
      ? [query.action]
      : query.group
        ? (actionsOfGroup(query.group) ?? [])
        : undefined,
    actorId: query.actorId,
    from: query.from ? new Date(`${query.from}T00:00:00Z`) : undefined,
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
  };
  const [rows, total] = await Promise.all([
    repository.listAudit(ctx.db, filters, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }),
    repository.countAudit(ctx.db, filters),
  ]);
  return {
    items: rows.map(toAuditView),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function listSensitiveActions(ctx: ServiceContext, limit = 5) {
  if (!can(ctx.actor, "audit:read")) return [];
  const rows = await repository.listAudit(
    ctx.db,
    { actions: SENSITIVE_ACTIONS },
    { limit, offset: 0 },
  );
  return rows.map(toAuditView);
}

export async function listAuditActors(ctx: ServiceContext) {
  assertCan(ctx.actor, "audit:read");
  return repository.listAuditActors(ctx.db);
}
