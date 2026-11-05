import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/audit.service";
import * as notificationRepository from "@/modules/platform/notifications.repository";
import { isTwoFactorRequired } from "@/modules/platform/settings.service";
import { getMemberIdForUser, getMembersByIds } from "@/modules/team/team.lookup";
import { can, type Permission } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { sessions, userPreferences } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { z } from "@/lib/zod";
import * as repository from "./admin.repository";
import { profileSchema } from "./admin.schema";

/**
 * Préférences de chacun (écran 14). Elles ne concernent que le compte connecté, sans autre droit :
 * tout membre de l'équipe a son profil, y compris s'il doit encore activer sa double authentification.
 */
export interface NotificationKindView {
  kind: string;
  label: string;
  inApp: boolean;
  email: boolean;
}

/** Les 4 premières lignes sont celles de l'écran 14. Filtrées par ce que le compte peut ouvrir. */
const NOTIFICATION_KINDS: readonly { kind: string; label: string; any?: readonly Permission[] }[] =
  [
    { kind: "client_message", label: "Un client écrit", any: ["messages:read", "support:read"] },
    { kind: "quote_signed", label: "Un devis est signé", any: ["quotes:read"] },
    { kind: "payment", label: "Un paiement arrive", any: ["finance:read"] },
    { kind: "site_down", label: "Un site tombe", any: ["sites:read"] },
    { kind: "mention", label: "On vous mentionne" },
    { kind: "ticket", label: "Une demande arrive", any: ["support:read"] },
    { kind: "ticket_critical", label: "Une demande est critique", any: ["support:read"] },
    {
      kind: "task_overdue",
      label: "Une tâche est en retard",
      any: ["tasks:read", "tasks:read_assigned"],
    },
    { kind: "deliverable", label: "Un livrable avance", any: ["projects:read"] },
    { kind: "budget_threshold", label: "Un budget atteint 80 %", any: ["projects:read"] },
    { kind: "requirement_overdue", label: "Un contenu manque", any: ["projects:read"] },
    { kind: "opportunity_won", label: "Une affaire est gagnée", any: ["sales:read"] },
    { kind: "opportunity_action", label: "Une affaire attend une action", any: ["sales:read"] },
    { kind: "quote_reminder", label: "Un devis est relancé", any: ["quotes:read"] },
    { kind: "contract", label: "Un contrat demande une action", any: ["contracts:read"] },
    { kind: "invoice_overdue", label: "Une facture est en retard", any: ["finance:read"] },
    { kind: "deployment_failed", label: "Un déploiement échoue", any: ["deployments:read"] },
    { kind: "backup_failed", label: "Une sauvegarde échoue", any: ["sites:read"] },
    { kind: "domain_expiring", label: "Un domaine arrive à échéance", any: ["sites:read"] },
  ];

const SESSIONS_SHOWN = 8;

/** Résumé lisible d'un user-agent : ni version, ni empreinte. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Appareil inconnu";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "Appareil";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Navigateur";
  return `${device} · ${browser}`;
}

async function kindsFor(ctx: ServiceContext): Promise<NotificationKindView[]> {
  const stored = await notificationRepository.listPreferences(ctx.db, ctx.actor.userId);
  const byKind = new Map(stored.map((row) => [row.kind, row]));
  return NOTIFICATION_KINDS.filter(
    (entry) => !entry.any || entry.any.some((permission) => can(ctx.actor, permission)),
  ).map((entry) => ({
    kind: entry.kind,
    label: entry.label,
    inApp: byKind.get(entry.kind)?.inApp ?? true,
    email: byKind.get(entry.kind)?.email ?? false,
  }));
}

async function readPreferences(db: Database, userId: string) {
  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getProfile(
  ctx: ServiceContext,
  options: { currentSessionId: string | null; nodeEnv: string | undefined; now?: Date },
) {
  const now = options.now ?? new Date();
  const [
    preferences,
    kinds,
    sessionRows,
    sessionsTotal,
    twoFactorEnabled,
    twoFactorRequired,
    memberId,
  ] = await Promise.all([
    readPreferences(ctx.db, ctx.actor.userId),
    kindsFor(ctx),
    repository.listSessions(ctx.db, ctx.actor.userId, now, SESSIONS_SHOWN),
    repository.countSessions(ctx.db, ctx.actor.userId, now),
    repository.findTwoFactorEnabled(ctx.db, ctx.actor.userId),
    isTwoFactorRequired(ctx.db, options.nodeEnv),
    getMemberIdForUser(ctx.db, ctx.actor.userId),
  ]);
  const [member] = memberId ? await getMembersByIds(ctx.db, [memberId]) : [];

  return {
    identity: {
      name: ctx.actor.name,
      email: ctx.actor.email,
      title: member?.title ?? null,
    },
    appearance: {
      theme: preferences?.theme ?? "light",
      accent: preferences?.accent ?? "blue",
      density: preferences?.density ?? "comfortable",
      homePath: preferences?.homePath ?? "/",
    },
    dailyDigest: preferences?.dailyDigest ?? false,
    notifications: kinds,
    twoFactorEnabled,
    twoFactorRequired,
    sessionsTotal,
    sessions: sessionRows.map((row) => ({
      id: row.id,
      label: describeUserAgent(row.userAgent),
      lastActiveAt: row.updatedAt,
      current: row.id === options.currentSessionId,
    })),
  };
}

export type ProfileView = Awaited<ReturnType<typeof getProfile>>;

export async function updateProfile(
  ctx: ServiceContext,
  rawInput: unknown,
  options: { allowedHomePaths: readonly string[] },
): Promise<void> {
  const input = parseInput(profileSchema, rawInput);
  const homePath = input.homePath ?? "/";
  if (!options.allowedHomePaths.includes(homePath)) {
    throw new ValidationError("Cette page n'est pas accessible à votre compte.", {
      homePath: ["Page d'accueil invalide."],
    });
  }
  const allowedKinds = new Set((await kindsFor(ctx)).map((entry) => entry.kind));

  await ctx.db.transaction(async (tx) => {
    const values = {
      theme: input.theme,
      accent: input.accent,
      density: input.density,
      homePath,
      dailyDigest: input.dailyDigest,
    };
    await tx
      .insert(userPreferences)
      .values({ userId: ctx.actor.userId, ...values })
      .onConflictDoUpdate({ target: userPreferences.userId, set: values });
    for (const preference of input.preferences) {
      if (!allowedKinds.has(preference.kind)) continue;
      await notificationRepository.upsertPreference(tx, ctx.actor.userId, preference.kind, {
        inApp: preference.inApp,
        email: preference.email,
      });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user_preference.updated",
      entityType: "user_preference",
      entityId: ctx.actor.userId,
      metadata: { theme: input.theme, density: input.density, dailyDigest: input.dailyDigest },
    });
  });
}

/** « Se déconnecter partout » : toutes les sessions du compte, y compris celle-ci. */
export async function revokeAllMySessions(ctx: ServiceContext): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const revoked = await repository.deleteSessions(tx, ctx.actor.userId);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user.sessions_revoked",
      entityType: "user",
      entityId: ctx.actor.userId,
      metadata: { revoked, via: "profile" },
    });
    return revoked;
  });
}

/** Ferme une session précise du compte. Celle d'un autre compte répond 404. */
export async function revokeMySession(ctx: ServiceContext, rawId: unknown): Promise<void> {
  const id = parseInput(z.uuid(), rawId);
  await ctx.db.transaction(async (tx) => {
    const deleted = await tx
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, ctx.actor.userId)))
      .returning({ id: sessions.id });
    if (deleted.length === 0) throw new NotFoundError("Session introuvable.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user.sessions_revoked",
      entityType: "user",
      entityId: ctx.actor.userId,
      metadata: { revoked: 1, via: "profile" },
    });
  });
}

/** Page d'accueil enregistrée, pour la redirection après connexion. */
export async function getHomePath(db: Database, userId: string): Promise<string | null> {
  return (await readPreferences(db, userId))?.homePath ?? null;
}
