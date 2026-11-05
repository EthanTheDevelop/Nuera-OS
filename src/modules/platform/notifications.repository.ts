import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NotificationSeverity } from "@/lib/domain-enums";
import type { Role } from "@/server/auth/roles";
import { notificationPreferences, notifications, userPreferences, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/** Apparence enregistrée du compte, pour la coque. */
export async function findAppearance(db: Database, userId: string) {
  const [row] = await db
    .select({
      theme: userPreferences.theme,
      accent: userPreferences.accent,
      density: userPreferences.density,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ?? null;
}

export interface NotificationRecipient {
  id: string;
  email: string;
}

/** Comptes actifs d'un rôle. Un compte désactivé ne reçoit plus rien. */
export async function findRecipientsByRole(
  db: Database,
  role: Role,
): Promise<NotificationRecipient[]> {
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.role, role), eq(users.banned, false)));
}

export async function findRecipientsByIds(
  db: Database,
  ids: readonly string[],
): Promise<NotificationRecipient[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(inArray(users.id, [...ids]), eq(users.banned, false)));
}

export async function findPreferencesForKind(
  db: Database,
  userIds: readonly string[],
  kind: string,
): Promise<Map<string, { inApp: boolean; email: boolean }>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(
      and(
        inArray(notificationPreferences.userId, [...userIds]),
        eq(notificationPreferences.kind, kind),
      ),
    );
  return new Map(rows.map((row) => [row.userId, { inApp: row.inApp, email: row.email }]));
}

export interface NewNotification {
  userId: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  dedupeKey: string;
}

/** Une ligne déjà présente pour (compte, clé) est ignorée : rien ne se répète. */
export async function insertNotifications(
  db: Database,
  rows: readonly NewNotification[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(notifications)
    .values([...rows])
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] });
}

export async function markEmailed(
  db: Database,
  userIds: readonly string[],
  dedupeKey: string,
  at: Date,
): Promise<void> {
  if (userIds.length === 0) return;
  await db
    .update(notifications)
    .set({ emailedAt: at })
    .where(
      and(inArray(notifications.userId, [...userIds]), eq(notifications.dedupeKey, dedupeKey)),
    );
}

export async function listNotifications(
  db: Database,
  userId: string,
  options: { limit: number; offset: number; unreadOnly?: boolean },
) {
  const conditions = [eq(notifications.userId, userId)];
  if (options.unreadOnly) conditions.push(isNull(notifications.readAt));
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(options.limit)
    .offset(options.offset);
}

export async function countNotifications(
  db: Database,
  userId: string,
  options: { unreadOnly?: boolean } = {},
): Promise<number> {
  const conditions = [eq(notifications.userId, userId)];
  if (options.unreadOnly) conditions.push(isNull(notifications.readAt));
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(...conditions));
  return row?.value ?? 0;
}

/** Limité au compte courant : la notification d'un autre reste introuvable. */
export async function findNotification(db: Database, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function markRead(db: Database, userId: string, id: string, at: Date): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: at })
    .where(
      and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)),
    );
}

export async function markAllRead(db: Database, userId: string, at: Date): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: at })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: sql<string>`${notifications.id}` });
  return rows.length;
}

export async function listPreferences(db: Database, userId: string) {
  return db
    .select({
      kind: notificationPreferences.kind,
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
}

export async function upsertPreference(
  db: Database,
  userId: string,
  kind: string,
  values: { inApp: boolean; email: boolean },
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ userId, kind, ...values })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.kind],
      set: values,
    });
}
