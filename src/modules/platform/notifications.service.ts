import { formatRelativeDate } from "@/lib/format";
import type { NotificationSeverity } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import type { Role } from "@/server/auth/roles";
import { getEnv } from "@/server/config/env";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { NotFoundError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { enqueueEmail } from "./email-outbox";
import * as repository from "./notifications.repository";

/** Destinataires : des comptes précis ou tous les comptes d'un rôle. */
export type NotifyRecipients =
  { userIds: readonly string[]; role?: never } | { role: Role; userIds?: never };

export type NotifyInput = NotifyRecipients & {
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Unique par destinataire : la même alerte ne se répète pas (parcours 5). */
  dedupeKey: string;
};

/** Sans préférence enregistrée : notification dans l'application, pas d'e-mail. */
const DEFAULT_PREFERENCE = { inApp: true, email: false };

/** Chemin de l'application. Les navigateurs lisent `/\` comme `//` : ce serait un autre site. */
export function isInternalHref(href: string | null | undefined): href is string {
  return typeof href === "string" && /^\/(?![/\\])/.test(href);
}

/** URL absolue d'un lien interne pour un e-mail. Sans configuration lisible, pas de lien. */
export function absoluteAppUrl(href: string | null | undefined): string | null {
  if (!isInternalHref(href)) return null;
  try {
    return new URL(href, getEnv().BETTER_AUTH_URL).toString();
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Corps d'un e-mail de notification : le titre, l'extrait, le lien vers l'objet. */
export function renderNotificationEmail(input: {
  title: string;
  body?: string | null;
  url?: string | null;
  linkLabel?: string;
}): { text: string; html: string } {
  const text = [input.title, input.body ?? "", input.url ?? ""]
    .filter((line) => line !== "")
    .join("\n\n");
  const html = [
    `<p><strong>${escapeHtml(input.title)}</strong></p>`,
    input.body ? `<p>${escapeHtml(input.body)}</p>` : "",
    input.url
      ? `<p><a href="${escapeHtml(input.url)}">${escapeHtml(input.linkLabel ?? "Ouvrir dans Nuera OS")}</a></p>`
      : "",
  ].join("");
  return { text, html };
}

/**
 * Crée les notifications dans la transaction de l'opération, sans doublon.
 *
 * `notification_preferences` fait foi par (compte, type) : l'interne et l'e-mail se règlent
 * séparément. Un e-mail passe par `email_outbox`, avec une clé par compte : il ne part qu'une fois.
 * Un compte désactivé ne reçoit rien.
 */
export async function notify(tx: Database, input: NotifyInput): Promise<void> {
  const recipients = input.role
    ? await repository.findRecipientsByRole(tx, input.role)
    : await repository.findRecipientsByIds(tx, input.userIds ?? []);
  if (recipients.length === 0) return;

  const preferences = await repository.findPreferencesForKind(
    tx,
    recipients.map((recipient) => recipient.id),
    input.kind,
  );
  const preferenceOf = (userId: string) => preferences.get(userId) ?? DEFAULT_PREFERENCE;

  await repository.insertNotifications(
    tx,
    recipients
      .filter((recipient) => preferenceOf(recipient.id).inApp)
      .map((recipient) => ({
        userId: recipient.id,
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey,
      })),
  );

  const emailed = recipients.filter((recipient) => preferenceOf(recipient.id).email);
  if (emailed.length === 0) return;
  const { text, html } = renderNotificationEmail({
    title: input.title,
    body: input.body,
    url: absoluteAppUrl(input.href),
  });
  for (const recipient of emailed) {
    await enqueueEmail(tx, {
      to: recipient.email,
      subject: input.title,
      text,
      html,
      template: `notification:${input.kind}`,
      dedupeKey: `notification:${recipient.id}:${input.dedupeKey}`,
    });
  }
  await repository.markEmailed(
    tx,
    emailed.map((recipient) => recipient.id),
    input.dedupeKey,
    new Date(),
  );
}

// --- Centre de notifications --------------------------------------------------------------------

export interface NotificationView {
  id: string;
  title: string;
  body?: string;
  severity: NotificationSeverity;
  date: string;
  /** Marque comme lue, puis mène à l'objet. Absent : la notification n'a pas de lien. */
  href?: string;
  unread: boolean;
}

/** Route interne qui marque lue et redirige : la notification mène toujours à son objet. */
export function notificationOpenHref(id: string): string {
  return `/profil/notifications/${id}`;
}

function toView(
  row: Awaited<ReturnType<typeof repository.listNotifications>>[number],
  now: Date,
): NotificationView {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? undefined,
    severity: row.severity,
    date: formatRelativeDate(row.createdAt, now),
    href: row.href ? notificationOpenHref(row.id) : undefined,
    unread: row.readAt === null,
  };
}

/** Les dernières notifications du compte courant, pour la coque. Un compte ne lit que les siennes. */
export async function getNotificationCenter(
  db: Database,
  userId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<{ items: NotificationView[]; unread: number }> {
  const now = options.now ?? new Date();
  const [rows, unread] = await Promise.all([
    repository.listNotifications(db, userId, { limit: options.limit ?? 15, offset: 0 }),
    repository.countNotifications(db, userId, { unreadOnly: true }),
  ]);
  return { items: rows.map((row) => toView(row, now)), unread };
}

const listSchema = z.object({
  // Paramètre d'URL : une valeur illisible vaut la première page.
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  unreadOnly: z.boolean().default(false),
});

export async function listMyNotifications(ctx: ServiceContext, rawInput: unknown = {}) {
  const input = parseInput(listSchema, rawInput);
  const now = new Date();
  const [rows, total] = await Promise.all([
    repository.listNotifications(ctx.db, ctx.actor.userId, {
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
      unreadOnly: input.unreadOnly,
    }),
    repository.countNotifications(ctx.db, ctx.actor.userId, { unreadOnly: input.unreadOnly }),
  ]);
  return {
    items: rows.map((row) => toView(row, now)),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

/**
 * Marque lue et renvoie le lien de l'objet. Une notification d'un autre compte répond 404. Un lien
 * enregistré qui ne serait pas interne n'est jamais suivi.
 */
export async function openNotification(
  ctx: ServiceContext,
  rawId: string,
): Promise<{ href: string | null }> {
  const id = parseInput(z.uuid(), rawId);
  const row = await repository.findNotification(ctx.db, ctx.actor.userId, id);
  if (!row) throw new NotFoundError();
  await repository.markRead(ctx.db, ctx.actor.userId, id, new Date());
  return { href: isInternalHref(row.href) ? row.href : null };
}

export async function markAllNotificationsRead(ctx: ServiceContext): Promise<number> {
  return repository.markAllRead(ctx.db, ctx.actor.userId, new Date());
}
