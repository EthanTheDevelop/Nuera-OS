import { and, desc, eq, isNotNull, isNull, not, like } from "drizzle-orm";
import {
  activities,
  companies,
  contacts,
  crmSyncState,
  opportunities,
  syncRuns,
  webhookReceipts,
} from "@/server/db/schema";
import type { CrmSyncState } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { SEED_TWENTY_ID_PREFIX } from "./crm.shared";

export async function getSyncState(db: Database, object: string): Promise<CrmSyncState | null> {
  const [row] = await db
    .select()
    .from(crmSyncState)
    .where(eq(crmSyncState.object, object))
    .limit(1);
  return row ?? null;
}

export async function saveSyncState(
  db: Database,
  object: string,
  values: { cursor?: string | null; lastRunAt: Date; lastError: string | null },
): Promise<void> {
  await db
    .insert(crmSyncState)
    .values({ object, ...values })
    .onConflictDoUpdate({ target: crmSyncState.object, set: values });
}

export async function insertSyncRun(db: Database, scope: string): Promise<string> {
  const [row] = await db
    .insert(syncRuns)
    .values({ service: "twenty", scope, status: "running" })
    .returning({ id: syncRuns.id });
  if (!row) throw new Error("Exécution de synchronisation non créée");
  return row.id;
}

export async function finishSyncRun(
  db: Database,
  id: string,
  values: { status: "succeeded" | "failed"; items: number; error: string | null },
): Promise<void> {
  await db
    .update(syncRuns)
    .set({ ...values, finishedAt: new Date() })
    .where(eq(syncRuns.id, id));
}

export async function latestSyncRuns(db: Database, scope: string) {
  const [latest, succeeded] = await Promise.all([
    db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.service, "twenty"), eq(syncRuns.scope, scope)))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1),
    db
      .select()
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.service, "twenty"),
          eq(syncRuns.scope, scope),
          eq(syncRuns.status, "succeeded"),
        ),
      )
      .orderBy(desc(syncRuns.startedAt))
      .limit(1),
  ]);
  return { latest: latest[0] ?? null, lastSuccess: succeeded[0] ?? null };
}

/** Lignes actives à comparer aux identifiants de Twenty. Le jeu d'essai n'y figure jamais. */
export async function listLiveTwentyIds(
  db: Database,
  object: "company" | "person" | "opportunity" | "note" | "task",
): Promise<{ id: string; twentyId: string }[]> {
  const notSeed = (
    column: typeof companies.twentyId | typeof contacts.twentyId | typeof opportunities.twentyId,
  ) => not(like(column, `${SEED_TWENTY_ID_PREFIX}%`));
  if (object === "company") {
    return db
      .select({ id: companies.id, twentyId: companies.twentyId })
      .from(companies)
      .where(and(isNull(companies.archivedAt), notSeed(companies.twentyId)));
  }
  if (object === "person") {
    return db
      .select({ id: contacts.id, twentyId: contacts.twentyId })
      .from(contacts)
      .where(and(isNull(contacts.archivedAt), notSeed(contacts.twentyId)));
  }
  if (object === "opportunity") {
    return db
      .select({ id: opportunities.id, twentyId: opportunities.twentyId })
      .from(opportunities)
      .where(and(isNull(opportunities.archivedAt), notSeed(opportunities.twentyId)));
  }
  const rows = await db
    .select({ id: activities.id, twentyId: activities.twentyId })
    .from(activities)
    .where(
      and(
        eq(activities.kind, object),
        isNotNull(activities.twentyId),
        not(like(activities.twentyId, `${SEED_TWENTY_ID_PREFIX}%`)),
      ),
    );
  return rows.flatMap((row) => (row.twentyId ? [{ id: row.id, twentyId: row.twentyId }] : []));
}

/** Fiche disparue de Twenty : archivée ici, jamais effacée, pour garder ses liens et son historique. */
export async function archiveByTwentyId(
  db: Database,
  object: "company" | "person" | "opportunity",
  twentyId: string,
  at: Date,
): Promise<boolean> {
  const table = object === "company" ? companies : object === "person" ? contacts : opportunities;
  const rows = await db
    .update(table)
    .set({ archivedAt: at })
    .where(and(eq(table.twentyId, twentyId), isNull(table.archivedAt)))
    .returning({ id: table.id });
  return rows.length > 0;
}

export async function insertWebhookReceipt(
  db: Database,
  externalId: string,
): Promise<string | null> {
  const [row] = await db
    .insert(webhookReceipts)
    .values({ service: "twenty", externalId, status: "received" })
    .onConflictDoNothing()
    .returning({ id: webhookReceipts.id });
  return row?.id ?? null;
}

export async function setWebhookReceiptStatus(
  db: Database,
  id: string,
  status: "processed" | "failed" | "ignored",
): Promise<void> {
  await db.update(webhookReceipts).set({ status }).where(eq(webhookReceipts.id, id));
}
