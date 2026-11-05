import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { automationRules, automationRuns, domainEvents } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export type RuleSeed = {
  key: string;
  name: string;
  triggerLabel: string;
  actionLabel: string;
  toolLabel: string;
  enabled: boolean;
};

/** Crée les règles manquantes et met à jour leurs libellés. N'écrase jamais `enabled`. */
export async function upsertRules(db: Database, seeds: readonly RuleSeed[]): Promise<void> {
  for (const seed of seeds) {
    await db
      .insert(automationRules)
      .values(seed)
      .onConflictDoUpdate({
        target: automationRules.key,
        set: {
          name: seed.name,
          triggerLabel: seed.triggerLabel,
          actionLabel: seed.actionLabel,
          toolLabel: seed.toolLabel,
        },
      });
  }
}

export async function listRules(db: Database) {
  return db.select().from(automationRules).orderBy(asc(automationRules.createdAt));
}

export async function findRule(db: Database, key: string) {
  const [row] = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.key, key))
    .limit(1);
  return row ?? null;
}

export async function setRuleEnabled(db: Database, key: string, enabled: boolean) {
  const [row] = await db
    .update(automationRules)
    .set({ enabled })
    .where(eq(automationRules.key, key))
    .returning();
  return row ?? null;
}

export async function listPendingEvents(db: Database, limit: number) {
  return db
    .select()
    .from(domainEvents)
    .where(isNull(domainEvents.dispatchedAt))
    .orderBy(asc(domainEvents.occurredAt), asc(domainEvents.id))
    .limit(limit);
}

export async function findEvent(db: Database, id: string) {
  const [row] = await db.select().from(domainEvents).where(eq(domainEvents.id, id)).limit(1);
  return row ?? null;
}

export async function markEventDispatched(db: Database, id: string, at: Date): Promise<void> {
  await db
    .update(domainEvents)
    .set({ dispatchedAt: at })
    .where(and(eq(domainEvents.id, id), isNull(domainEvents.dispatchedAt)));
}

/** Prend la main sur (règle, événement). `null` : une autre exécution existe déjà. */
export async function claimNewRun(db: Database, ruleKey: string, eventId: string, at: Date) {
  const [row] = await db
    .insert(automationRuns)
    .values({ ruleKey, eventId, status: "running", startedAt: at, attempts: 1 })
    .onConflictDoNothing({ target: [automationRuns.ruleKey, automationRuns.eventId] })
    .returning();
  return row ?? null;
}

export async function findRun(db: Database, ruleKey: string, eventId: string) {
  const [row] = await db
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.ruleKey, ruleKey), eq(automationRuns.eventId, eventId)))
    .limit(1);
  return row ?? null;
}

export async function findRunById(db: Database, id: string) {
  const [row] = await db.select().from(automationRuns).where(eq(automationRuns.id, id)).limit(1);
  return row ?? null;
}

/**
 * Nouvelle tentative, atomique : une exécution en échec, ou « en cours » depuis trop longtemps
 * (processus interrompu). Deux lanceurs concurrents ne peuvent pas la reprendre tous les deux.
 */
export async function reclaimRun(
  db: Database,
  input: { id: string; expectedAttempts: number; staleBefore: Date; at: Date },
) {
  const [row] = await db
    .update(automationRuns)
    .set({
      status: "running",
      attempts: input.expectedAttempts + 1,
      startedAt: input.at,
      finishedAt: null,
      error: null,
    })
    .where(
      and(
        eq(automationRuns.id, input.id),
        eq(automationRuns.attempts, input.expectedAttempts),
        or(
          eq(automationRuns.status, "failed"),
          and(
            eq(automationRuns.status, "running"),
            lt(automationRuns.startedAt, input.staleBefore),
          ),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** Une exécution de cet événement tourne, ou attend encore un essai automatique. */
export async function hasOpenRuns(
  db: Database,
  eventId: string,
  maxAttempts: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.eventId, eventId),
        or(
          eq(automationRuns.status, "running"),
          and(eq(automationRuns.status, "failed"), lt(automationRuns.attempts, maxAttempts)),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function finishRun(
  db: Database,
  id: string,
  values: {
    status: "succeeded" | "failed" | "skipped";
    error: string | null;
    result: Record<string, unknown> | null;
    at: Date;
  },
): Promise<void> {
  await db
    .update(automationRuns)
    .set({
      status: values.status,
      error: values.error,
      result: values.result,
      finishedAt: values.at,
    })
    .where(eq(automationRuns.id, id));
}

/** Compte par règle et par statut, depuis une date. */
export async function countRunsByRule(db: Database, since: Date) {
  return db
    .select({
      ruleKey: automationRuns.ruleKey,
      status: automationRuns.status,
      value: count(),
    })
    .from(automationRuns)
    .where(gte(automationRuns.startedAt, since))
    .groupBy(automationRuns.ruleKey, automationRuns.status);
}

/** Échecs qu'on peut relancer : une règle encore au catalogue, un événement connu. */
function retryable(ruleKeys: readonly string[]) {
  return and(
    eq(automationRuns.status, "failed"),
    inArray(automationRuns.ruleKey, [...ruleKeys]),
    isNotNull(automationRuns.eventId),
  );
}

export async function countFailedRuns(db: Database, ruleKeys: readonly string[]): Promise<number> {
  const [row] = await db.select({ value: count() }).from(automationRuns).where(retryable(ruleKeys));
  return row?.value ?? 0;
}

export async function countRuns(
  db: Database,
  filters: { status?: string; ruleKey?: string } = {},
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(automationRuns).where(runFilters(filters));
  return row?.value ?? 0;
}

function runFilters(filters: { status?: string; ruleKey?: string }) {
  const conditions = [];
  if (filters.status) {
    conditions.push(sql`${automationRuns.status} = ${filters.status}`);
  }
  if (filters.ruleKey) conditions.push(eq(automationRuns.ruleKey, filters.ruleKey));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Exécutions récentes, avec le nom de la règle et le type d'événement. */
export async function listRuns(
  db: Database,
  options: { limit: number; offset: number; status?: string; ruleKey?: string },
) {
  return db
    .select({
      id: automationRuns.id,
      ruleKey: automationRuns.ruleKey,
      ruleName: automationRules.name,
      eventId: automationRuns.eventId,
      eventType: domainEvents.type,
      status: automationRuns.status,
      attempts: automationRuns.attempts,
      error: automationRuns.error,
      startedAt: automationRuns.startedAt,
      finishedAt: automationRuns.finishedAt,
    })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRules.key, automationRuns.ruleKey))
    .leftJoin(domainEvents, eq(domainEvents.id, automationRuns.eventId))
    .where(runFilters(options))
    .orderBy(desc(automationRuns.startedAt), desc(automationRuns.id))
    .limit(options.limit)
    .offset(options.offset);
}

export async function listFailedRunIds(
  db: Database,
  ruleKeys: readonly string[],
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(retryable(ruleKeys))
    .orderBy(desc(automationRuns.startedAt))
    .limit(limit);
  return rows.map((row) => row.id);
}
