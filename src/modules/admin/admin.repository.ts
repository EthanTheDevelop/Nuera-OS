import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  like,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Role } from "@/server/auth/roles";
import { auditLog, sessions, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

const lastSignIn = sql<Date | null>`(
  select max(a.occurred_at) from audit_log a
  where a.actor_id = "users"."id" and a.action = 'auth.signed_in'
)`.mapWith((value) => (value ? new Date(value as string) : null));

function userFilters(filters: { q?: string; role?: Role }) {
  const conditions: SQL[] = [];
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`;
    const match = or(ilike(users.name, pattern), ilike(users.email, pattern));
    if (match) conditions.push(match);
  }
  if (filters.role) conditions.push(eq(users.role, filters.role));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Aucune colonne d'authentification : jamais d'empreinte, de jeton ni de secret. */
export async function listUsers(
  db: Database,
  options: { q?: string; role?: Role; limit: number; offset: number },
) {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      banned: users.banned,
      twoFactorEnabled: users.twoFactorEnabled,
      createdAt: users.createdAt,
      lastSignInAt: lastSignIn,
    })
    .from(users)
    .where(userFilters(options))
    .orderBy(asc(users.role), asc(users.name))
    .limit(options.limit)
    .offset(options.offset);
}

export async function countUsers(db: Database, filters: { q?: string; role?: Role }) {
  const [row] = await db.select({ value: count() }).from(users).where(userFilters(filters));
  return row?.value ?? 0;
}

export async function findUser(db: Database, id: string) {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      banned: users.banned,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}

export async function emailExists(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row !== undefined;
}

/**
 * Verrouille les associés actifs et les compte : deux retraits simultanés ne peuvent pas retirer
 * chacun l'avant-dernier associé.
 */
export async function lockActiveAdminIds(tx: Database): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.banned, false)))
    .for("update");
  return rows.map((row) => row.id);
}

export async function updateRole(tx: Database, id: string, role: Role): Promise<void> {
  await tx.update(users).set({ role }).where(eq(users.id, id));
}

export async function setBanned(
  tx: Database,
  id: string,
  values: { banned: boolean; banReason: string | null },
): Promise<void> {
  await tx
    .update(users)
    .set({ ...values, banExpires: null })
    .where(eq(users.id, id));
}

export async function deleteSessions(tx: Database, userId: string): Promise<number> {
  const rows = await tx
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return rows.length;
}

/** Les plus récentes seulement : un compte peut avoir accumulé beaucoup de sessions. */
export async function listSessions(db: Database, userId: string, now: Date, limit: number) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gte(sessions.expiresAt, now)))
    .orderBy(desc(sessions.updatedAt))
    .limit(limit);
}

export async function countSessions(db: Database, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gte(sessions.expiresAt, now)));
  return row?.value ?? 0;
}

export async function findTwoFactorEnabled(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.enabled ?? false;
}

// --- Journal ------------------------------------------------------------------------------------

export interface AuditFilters {
  actions?: readonly string[];
  actionPrefix?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  excludeActions?: readonly string[];
}

function auditFilters(filters: AuditFilters) {
  const conditions: SQL[] = [];
  if (filters.actions) conditions.push(inArray(auditLog.action, [...filters.actions]));
  if (filters.actionPrefix) conditions.push(like(auditLog.action, `${filters.actionPrefix}%`));
  if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId));
  if (filters.from) conditions.push(gte(auditLog.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(auditLog.occurredAt, filters.to));
  for (const action of filters.excludeActions ?? []) conditions.push(ne(auditLog.action, action));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listAudit(
  db: Database,
  filters: AuditFilters,
  options: { limit: number; offset: number },
) {
  return db
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      metadata: auditLog.metadata,
      actorId: auditLog.actorId,
      actorName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(auditFilters(filters))
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(options.limit)
    .offset(options.offset);
}

export async function countAudit(db: Database, filters: AuditFilters): Promise<number> {
  const [row] = await db.select({ value: count() }).from(auditLog).where(auditFilters(filters));
  return row?.value ?? 0;
}

export async function listAuditActors(db: Database) {
  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(asc(users.name));
}
