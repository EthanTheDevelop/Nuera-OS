import "server-only";
import { createHash } from "node:crypto";
import {
  IntegrationUnavailableError,
  type CrmGateway,
  type CrmPage,
  type CrmPageOptions,
  type CrmRecordMeta,
} from "@/integrations/twenty/crm-gateway";
import {
  receiveTwentyWebhook,
  type TwentyWebhookEvent,
} from "@/integrations/twenty/twenty.webhook";
import { recordAudit } from "@/modules/audit/audit.service";
import { projectOpportunity } from "@/modules/sales/opportunity.projection";
import { assertCan, can } from "@/server/auth/permissions";
import { requireCrm, type ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { isAppError, NotFoundError, ServiceUnavailableError } from "@/server/errors";
import { logger } from "@/server/logger";
import { findActivityByTwentyId, deleteActivityByTwentyId } from "./activity.repository";
import { findCompanyByTwentyId } from "./company.repository";
import { findContactByTwentyId } from "./contact.repository";
import {
  projectCompany,
  projectNote,
  projectPerson,
  projectTask,
  type ProjectionOutcome,
} from "./crm.projection";
import * as repository from "./crm.sync.repository";

/**
 * Réconciliation de la projection avec Twenty, et réception de ses webhooks.
 *
 * Les webhooks sont livrés au plus une fois et perdus au-delà de 60 par minute : ils accélèrent,
 * la réconciliation par curseur garantit. Sans contexte d'acteur pour rester appelable par une tâche
 * planifiée (`reconcileCrm({ db, crm })`), avec un bouton pour l'équipe (`syncCrmNow`).
 */
export interface CrmSyncDeps {
  db: Database;
  crm: CrmGateway;
}

/** Une fiche écrite pendant une lecture peut valider un `updatedAt` antérieur au curseur. */
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const PAGE_SIZE = 200;
/** Une purge dans Twenty ne laisse aucune trace : comparaison complète des identifiants. */
const FULL_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** En dessous, disparition plausible ; au-dessus, mauvais espace de travail ou instance neuve. */
const MAX_MISSING_WITHOUT_ALERT = 10;
export const RECONCILE_SCOPE = "reconcile";

export const CRM_SYNC_OBJECTS = [
  "company",
  "person",
  "opportunity",
  "note",
  "task",
  "noteTarget",
  "taskTarget",
] as const;
export type CrmSyncObject = (typeof CRM_SYNC_OBJECTS)[number];

export interface ReconcileCounts {
  seen: number;
  applied: number;
  skipped: number;
  removed: number;
  failed: number;
}

export interface ReconcileResult {
  runId: string;
  items: number;
  objects: Record<CrmSyncObject, ReconcileCounts>;
  crossCompanyContacts: number;
  warnings: string[];
}

function emptyCounts(): ReconcileCounts {
  return { seen: 0, applied: 0, skipped: 0, removed: 0, failed: 0 };
}

interface RunState {
  deps: CrmSyncDeps;
  now: Date;
  full: boolean;
  result: ReconcileResult;
  /** Activités déjà relues avec leurs liens pendant cette exécution. */
  freshActivities: Set<string>;
}

async function isFullScanDue(
  db: Database,
  object: CrmSyncObject,
  options: { full?: boolean },
  now: Date,
): Promise<boolean> {
  if (options.full) return true;
  const [state, scan] = await Promise.all([
    repository.getSyncState(db, object),
    repository.getSyncState(db, `${object}:full`),
  ]);
  if (!state?.cursor || !scan?.lastRunAt) return true;
  return now.getTime() - scan.lastRunAt.getTime() > FULL_SCAN_INTERVAL_MS;
}

async function reconcileObject<T extends CrmRecordMeta>(
  run: RunState,
  object: CrmSyncObject,
  full: boolean,
  list: (options: CrmPageOptions) => Promise<CrmPage<T>>,
  apply: (record: T) => Promise<ProjectionOutcome>,
): Promise<Set<string>> {
  const { db } = run.deps;
  const counts = run.result.objects[object];
  const state = await repository.getSyncState(db, object);
  const since =
    !full && state?.cursor
      ? new Date(new Date(state.cursor).getTime() - CURSOR_OVERLAP_MS).toISOString()
      : undefined;

  let cursor = state?.cursor ?? null;
  let page: string | undefined;
  let lastError: string | null = null;
  let blocked = false;
  const seen = new Set<string>();

  try {
    do {
      const batch: CrmPage<T> = await list({
        updatedSince: since,
        cursor: page,
        limit: PAGE_SIZE,
        includeDeleted: true,
      });
      for (const record of batch.items) {
        counts.seen += 1;
        seen.add(record.id);
        try {
          const outcome = await apply(record);
          counts[outcome] += 1;
        } catch (error) {
          if (error instanceof ServiceUnavailableError) throw error;
          // Le curseur reste avant cette fiche : elle sera retentée, les suivantes passent quand même.
          counts.failed += 1;
          blocked = true;
          lastError = isAppError(error) ? error.message : "Fiche illisible.";
          logger.error("crm.sync.record_failed", { object, recordId: record.id, error });
        }
        if (!blocked && (cursor === null || record.updatedAt > cursor)) cursor = record.updatedAt;
      }
      page = batch.nextCursor ?? undefined;
      await repository.saveSyncState(db, object, { cursor, lastRunAt: run.now, lastError });
    } while (page);
  } catch (error) {
    await repository.saveSyncState(db, object, {
      cursor,
      lastRunAt: run.now,
      lastError: isAppError(error) ? error.message : "Synchronisation interrompue.",
    });
    throw error;
  }
  return seen;
}

/**
 * Suppression définitive (perdant de fusion, purge) : invisible aux lectures, seule une comparaison
 * complète la révèle. Trop de manquants d'un coup : on n'archive rien et on le signale.
 */
async function detectRemovals(
  run: RunState,
  object: "company" | "person" | "opportunity" | "note" | "task",
  seen: Set<string>,
): Promise<void> {
  const { db } = run.deps;
  const live = await repository.listLiveTwentyIds(db, object);
  const missing = live.filter((row) => !seen.has(row.twentyId));
  await repository.saveSyncState(db, `${object}:full`, { lastRunAt: run.now, lastError: null });
  if (missing.length === 0) return;

  if (missing.length > Math.max(MAX_MISSING_WITHOUT_ALERT, Math.floor(live.length / 2))) {
    const warning = `${object} : ${missing.length} fiches absentes de Twenty sur ${live.length}, aucune archivée. Vérifier l'instance configurée.`;
    run.result.warnings.push(warning);
    logger.error("crm.sync.mass_removal_refused", { object, missing: missing.length });
    return;
  }
  for (const row of missing) {
    if (object === "note" || object === "task") {
      await deleteActivityByTwentyId(db, row.twentyId);
    } else {
      await repository.archiveByTwentyId(db, object, row.twentyId, run.now);
    }
    run.result.objects[object].removed += 1;
    logger.info("crm.sync.record_gone", { object, id: row.id });
  }
}

async function refreshActivity(
  run: RunState,
  activityType: "note" | "task",
  activityId: string,
): Promise<ProjectionOutcome> {
  if (run.freshActivities.has(activityId)) return "skipped";
  run.freshActivities.add(activityId);
  const { db, crm } = run.deps;
  try {
    if (activityType === "note") {
      const note = await crm.getNote(activityId);
      return await projectNote(db, note, note.targets);
    }
    const task = await crm.getTask(activityId);
    return await projectTask(db, task, task.targets);
  } catch (error) {
    // Note ou tâche archivée entre-temps : la passe sur l'objet s'en charge.
    if (error instanceof NotFoundError) return "skipped";
    throw error;
  }
}

/**
 * Réconcilie toute la projection. Idempotent : rejouer ne change rien, et le jeu d'essai (`seed-`)
 * est ignoré. Un 429 ou une coupure remonte en `ServiceUnavailableError` après avoir conservé le
 * travail fait : la prochaine exécution repart du dernier curseur.
 */
export async function reconcileCrm(
  deps: CrmSyncDeps,
  options: { actorId?: string | null; full?: boolean; now?: Date } = {},
): Promise<ReconcileResult> {
  if (!deps.crm.isConfigured) throw new IntegrationUnavailableError("not_configured");

  const { db, crm } = deps;
  const now = options.now ?? new Date();
  const runId = await repository.insertSyncRun(db, RECONCILE_SCOPE);
  const result: ReconcileResult = {
    runId,
    items: 0,
    objects: {
      company: emptyCounts(),
      person: emptyCounts(),
      opportunity: emptyCounts(),
      note: emptyCounts(),
      task: emptyCounts(),
      noteTarget: emptyCounts(),
      taskTarget: emptyCounts(),
    },
    crossCompanyContacts: 0,
    warnings: [],
  };
  const run: RunState = { deps, now, full: false, result, freshActivities: new Set() };

  try {
    const fullCompanies = await isFullScanDue(db, "company", options, now);
    const companies = await reconcileObject(
      run,
      "company",
      fullCompanies,
      (page) => crm.listCompanies(page),
      (record) => projectCompany(db, record),
    );
    if (fullCompanies) await detectRemovals(run, "company", companies);

    const fullPeople = await isFullScanDue(db, "person", options, now);
    const people = await reconcileObject(
      run,
      "person",
      fullPeople,
      (page) => crm.listPeople(page),
      (record) => projectPerson(db, record),
    );
    if (fullPeople) await detectRemovals(run, "person", people);

    const fullOpportunities = await isFullScanDue(db, "opportunity", options, now);
    const opportunities = await reconcileObject(
      run,
      "opportunity",
      fullOpportunities,
      (page) => crm.listOpportunities(page),
      async (record) => {
        const projection = await projectOpportunity(db, record);
        if (projection.crossCompanyContact) result.crossCompanyContacts += 1;
        return projection.outcome;
      },
    );
    if (fullOpportunities) await detectRemovals(run, "opportunity", opportunities);

    const fullNotes = await isFullScanDue(db, "note", options, now);
    const notes = await reconcileObject(
      run,
      "note",
      fullNotes,
      (page) => crm.listNotes(page),
      (record) => {
        run.freshActivities.add(record.id);
        return projectNote(db, record, record.deletedAt ? undefined : record.targets);
      },
    );
    if (fullNotes) await detectRemovals(run, "note", notes);

    const fullTasks = await isFullScanDue(db, "task", options, now);
    const tasks = await reconcileObject(
      run,
      "task",
      fullTasks,
      (page) => crm.listTasks(page),
      (record) => {
        run.freshActivities.add(record.id);
        return projectTask(db, record, record.deletedAt ? undefined : record.targets);
      },
    );
    if (fullTasks) await detectRemovals(run, "task", tasks);

    // Un lien ajouté ou retiré dans Twenty ne touche pas le `updatedAt` de l'activité.
    for (const [object, activityType] of [
      ["noteTarget", "note"],
      ["taskTarget", "task"],
    ] as const) {
      await reconcileObject(
        run,
        object,
        false,
        (page) => crm.listActivityLinks({ ...page, activityType }),
        (link) =>
          link.activityId
            ? refreshActivity(run, activityType, link.activityId)
            : Promise.resolve("skipped"),
      );
    }
  } catch (error) {
    result.items = countItems(result);
    await repository.finishSyncRun(db, runId, {
      status: "failed",
      items: result.items,
      error: isAppError(error) ? error.message : "Synchronisation interrompue.",
    });
    throw error;
  }

  result.items = countItems(result);
  const failed = Object.values(result.objects).reduce((sum, counts) => sum + counts.failed, 0);
  await db.transaction(async (tx) => {
    await repository.finishSyncRun(tx, runId, {
      status: "succeeded",
      items: result.items,
      error: failed > 0 ? `${failed} fiche(s) non synchronisée(s).` : (result.warnings[0] ?? null),
    });
    if (result.items > 0 || options.actorId) {
      await recordAudit(tx, {
        actorId: options.actorId ?? null,
        action: "crm.sync_ran",
        entityType: "crm_sync",
        entityId: runId,
        metadata: {
          items: result.items,
          failed,
          crossCompanyContacts: result.crossCompanyContacts,
          warnings: result.warnings,
        },
      });
    }
  });
  return result;
}

function countItems(result: ReconcileResult): number {
  return Object.values(result.objects).reduce(
    (sum, counts) => sum + counts.applied + counts.removed,
    0,
  );
}

/** Bouton « Synchroniser » : mêmes garanties que la tâche planifiée, avec un acteur journalisé. */
export async function syncCrmNow(
  ctx: ServiceContext,
  options: { full?: boolean } = {},
): Promise<ReconcileResult> {
  assertCan(ctx.actor, "crm:update");
  const crm = requireCrm(ctx);
  return reconcileCrm({ db: ctx.db, crm }, { actorId: ctx.actor.userId, full: options.full });
}

export interface CrmSyncStatus {
  /** `false` : aucune URL ni clé d'API, rien ne peut s'écrire dans Twenty. */
  configured: boolean;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  /** Dernière lecture réussie trop ancienne, ou absente : la projection s'affiche comme périmée. */
  stale: boolean;
  canSync: boolean;
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Toute lecture externe porte sa date (domain-model §6). */
export async function getCrmSyncStatus(ctx: ServiceContext): Promise<CrmSyncStatus> {
  assertCan(ctx.actor, "crm:read");
  const { latest, lastSuccess } = await repository.latestSyncRuns(ctx.db, RECONCILE_SCOPE);
  return {
    configured: Boolean(ctx.crm?.isConfigured),
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    lastAttemptAt: latest?.startedAt ?? null,
    lastError: latest?.status === "failed" ? (latest.error ?? null) : null,
    stale:
      !lastSuccess?.finishedAt || Date.now() - lastSuccess.finishedAt.getTime() > STALE_AFTER_MS,
    canSync: can(ctx.actor, "crm:update"),
  };
}

// --- Webhook ----------------------------------------------------------------------------------

function deletedRecord<T extends CrmRecordMeta>(
  event: { action: string; occurredAt: string },
  record: T,
): T {
  // Un `deleted` porte `deletedAt` ; on ne dépend pas de ce détail de format.
  return event.action === "deleted" && !record.deletedAt
    ? { ...record, deletedAt: event.occurredAt }
    : record;
}

async function isKnownLink(
  db: Database,
  event: Extract<TwentyWebhookEvent, { entity: "activityLink" }>,
) {
  const { record } = event;
  if (!record.target) return false;
  const activity = await findActivityByTwentyId(db, record.activityId);
  if (!activity) return false;
  if (record.target.type === "company") {
    const company = await findCompanyByTwentyId(db, record.target.id);
    return Boolean(company) && company?.id === activity.companyId;
  }
  if (record.target.type === "person") {
    const contact = await findContactByTwentyId(db, record.target.id);
    return Boolean(contact) && contact?.id === activity.contactId;
  }
  return false;
}

/** Applique un événement déjà authentifié à la projection. */
export async function applyTwentyEvent(
  deps: CrmSyncDeps,
  event: TwentyWebhookEvent,
): Promise<"processed" | "ignored"> {
  const { db, crm } = deps;
  const gone = event.action === "destroyed";
  const at = new Date(event.occurredAt);

  switch (event.entity) {
    case "company":
      if (gone) await repository.archiveByTwentyId(db, "company", event.recordId, at);
      else await projectCompany(db, deletedRecord(event, event.record));
      return "processed";
    case "person":
      if (gone) await repository.archiveByTwentyId(db, "person", event.recordId, at);
      else await projectPerson(db, deletedRecord(event, event.record));
      return "processed";
    case "opportunity":
      if (gone) await repository.archiveByTwentyId(db, "opportunity", event.recordId, at);
      else await projectOpportunity(db, deletedRecord(event, event.record));
      return "processed";
    case "note":
      if (gone) await deleteActivityByTwentyId(db, event.recordId);
      else await projectNote(db, deletedRecord(event, event.record));
      return "processed";
    case "task":
      if (gone) await deleteActivityByTwentyId(db, event.recordId);
      else await projectTask(db, deletedRecord(event, event.record));
      return "processed";
    case "activityLink": {
      const { activityType, activityId } = event.record;
      if (!activityId) return "ignored";
      // Écho d'une écriture de Nuera : le lien est déjà en place, pas de requête de plus.
      if (event.action === "created" && (await isKnownLink(db, event))) return "ignored";
      try {
        if (activityType === "note") {
          const note = await crm.getNote(activityId);
          await projectNote(db, note, note.targets);
        } else {
          const task = await crm.getTask(activityId);
          await projectTask(db, task, task.targets);
        }
      } catch (error) {
        if (error instanceof NotFoundError) return "ignored";
        throw error;
      }
      return "processed";
    }
    case "other":
      return "ignored";
  }
}

export type TwentyWebhookOutcome = "processed" | "ignored" | "duplicate" | "failed";

/**
 * Point d'entrée de la route `POST /api/webhooks/twenty`. Vérifie la signature sur le corps BRUT,
 * dédoublonne par `webhook_receipts`, met à jour la projection. Une signature invalide lève
 * `TwentyWebhookRejectedError` sans rien écrire. Un échec d'application laisse le reçu en `failed` :
 * Twenty ne relivre jamais, la réconciliation rattrape.
 */
export async function handleTwentyWebhook(
  deps: CrmSyncDeps,
  input: {
    rawBody: string;
    headers: Headers | Record<string, string | string[] | undefined>;
    secret: string;
    nowMs?: number;
  },
): Promise<TwentyWebhookOutcome> {
  const { event, nonce } = receiveTwentyWebhook(input);
  const externalId = nonce ?? createHash("sha256").update(input.rawBody).digest("hex");

  const receiptId = await repository.insertWebhookReceipt(deps.db, externalId);
  if (!receiptId) return "duplicate";

  try {
    const outcome = await applyTwentyEvent(deps, event);
    await repository.setWebhookReceiptStatus(deps.db, receiptId, outcome);
    return outcome;
  } catch (error) {
    logger.error("crm.webhook.failed", { eventName: event.eventName, error });
    await repository.setWebhookReceiptStatus(deps.db, receiptId, "failed");
    return "failed";
  }
}
