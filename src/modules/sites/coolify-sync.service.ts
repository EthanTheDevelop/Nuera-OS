import { getCoolifyGateway, type CoolifyGateway } from "@/integrations/coolify";
import {
  mapApplicationStatus,
  mapBackupStatus,
  parseCoolifyDate,
} from "@/integrations/coolify/coolify.mappers";
import type { CoolifyWebhookEvent } from "@/integrations/coolify/coolify.webhook";
import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/types";
import { AppError, ServiceUnavailableError } from "@/server/errors";
import { logger } from "@/server/logger";
import { upsertExternalBackup } from "./backup.service";
import { applyExternalDeployment } from "./deployment.service";
import * as repository from "./site.repository";

/**
 * Synchronisation Coolify → tables locales, appelable par une tâche planifiée ou par un bouton.
 * Chaque passage laisse une trace dans `sync_runs` et met à jour `integration_connections`. Chaque
 * écriture est idempotente : relancer ne crée aucun doublon.
 */
const SCOPE = "applications+deployments+backups";
const CONCURRENCY = 4;
/** Une réservation sans identifiant Coolify après ce délai n'arrivera plus. */
const ORPHAN_RESERVATION_MS = 15 * 60_000;

export interface SyncResult {
  items: number;
  /** Échecs partiels : le passage continue, ils sont listés dans la trace. */
  failures: number;
}

function failureMessage(error: unknown): string {
  return error instanceof AppError ? error.message : "Erreur interne.";
}

async function eachLimit<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        if (item !== undefined) await worker(item);
      }
    }),
  );
}

/**
 * Sauvegardes : Coolify ne les expose que par base de données. Une base est attribuée à un
 * environnement si elle vit dans le même environnement Coolify que son application, et si une seule
 * application reliée s'y trouve. Sinon l'attribution serait une supposition : rien n'est écrit.
 */
async function syncBackups(
  db: Database,
  coolify: CoolifyGateway,
  linked: repository.LinkedEnvironment[],
  environmentIdByApp: Map<string, number>,
  now: Date,
): Promise<number> {
  const linkedByCoolifyEnvironment = new Map<number, repository.LinkedEnvironment[]>();
  for (const environment of linked) {
    const coolifyEnvironmentId = environmentIdByApp.get(environment.coolifyAppUuid);
    if (coolifyEnvironmentId === undefined) continue;
    const list = linkedByCoolifyEnvironment.get(coolifyEnvironmentId) ?? [];
    list.push(environment);
    linkedByCoolifyEnvironment.set(coolifyEnvironmentId, list);
  }

  const resources = await coolify.listResources();
  const databases = resources.flatMap((resource) => {
    if (!resource.type?.startsWith("standalone-") || resource.environment_id == null) return [];
    const owners = linkedByCoolifyEnvironment.get(resource.environment_id);
    const owner = owners?.length === 1 ? owners[0] : undefined;
    return owner ? [{ uuid: resource.uuid, owner }] : [];
  });

  let items = 0;
  await eachLimit(databases, async ({ uuid, owner }) => {
    items += await syncDatabaseBackups(db, coolify, uuid, owner, now);
  });
  return items;
}

async function syncDatabaseBackups(
  db: Database,
  coolify: CoolifyGateway,
  databaseUuid: string,
  owner: repository.LinkedEnvironment,
  now: Date,
): Promise<number> {
  let items = 0;
  const configs = await coolify.listDatabaseBackups(databaseUuid);
  for (const config of configs) {
    const executions = await coolify.listBackupExecutions(databaseUuid, config.uuid);
    for (const execution of executions) {
      const status = mapBackupStatus(execution.status);
      if (!status) continue;
      await db.transaction((tx) =>
        upsertExternalBackup(
          tx,
          { siteId: owner.siteId, environmentId: owner.id, companyId: owner.companyId },
          {
            externalId: execution.uuid,
            status,
            takenAt:
              parseCoolifyDate(execution.created_at) ?? parseCoolifyDate(execution.finished_at),
            sizeBytes: execution.size ?? null,
            // Seule la preuve d'un envoi compte : `save_s3` n'est qu'une intention.
            offSite: execution.s3_uploaded === true,
          },
          now,
        ),
      );
      items += 1;
    }
  }
  return items;
}

/**
 * Lit les applications, leurs derniers déploiements et leurs sauvegardes.
 * Lève `ServiceUnavailableError` si la connexion n'est pas configurée, sans trace d'échec.
 */
export async function runCoolifySync(
  db: Database,
  deps: { coolify?: CoolifyGateway; now?: Date } = {},
): Promise<SyncResult> {
  const coolify = deps.coolify ?? getCoolifyGateway();
  const now = deps.now ?? new Date();

  if (!coolify.isConfigured) {
    await repository.recordIntegrationCheck(db, "coolify", {
      status: "not_configured",
      checkedAt: now,
      error: null,
    });
    throw new ServiceUnavailableError(
      "coolify",
      "not_configured",
      "Connexion requise : l'URL ou le jeton d'API de Coolify n'est pas renseigné.",
    );
  }

  const run = await repository.startSyncRun(db, "coolify", SCOPE);
  let items = 0;
  const failures: string[] = [];

  try {
    await repository.failOrphanReservations(db, new Date(now.getTime() - ORPHAN_RESERVATION_MS));

    const [applications, linked] = await Promise.all([
      coolify.listApplications(),
      repository.listCoolifyLinkedEnvironments(db),
    ]);
    const applicationsByUuid = new Map(applications.map((app) => [app.uuid, app]));
    const environmentIdByApp = new Map(
      applications.flatMap((app) =>
        app.environment_id == null ? [] : [[app.uuid, app.environment_id] as const],
      ),
    );

    await eachLimit(linked, async (environment) => {
      try {
        const application = applicationsByUuid.get(environment.coolifyAppUuid);
        await repository.updateEnvironmentStatus(
          db,
          environment.id,
          application ? mapApplicationStatus(application.status) : "unknown",
          now,
        );
        items += 1;

        if (!application) {
          failures.push(`Application ${environment.coolifyAppUuid} inconnue de Coolify`);
          return;
        }
        const deployments = await coolify.listApplicationDeployments(environment.coolifyAppUuid);
        // Du plus ancien au plus récent : les événements sortent dans l'ordre.
        for (const deployment of [...deployments].reverse()) {
          await db.transaction((tx) =>
            applyExternalDeployment(
              tx,
              {
                environmentId: environment.id,
                siteId: environment.siteId,
                companyId: environment.companyId,
              },
              deployment,
              now,
            ),
          );
          items += 1;
        }
      } catch (error) {
        failures.push(`${environment.coolifyAppUuid} : ${failureMessage(error)}`);
      }
    });

    try {
      items += await syncBackups(db, coolify, linked, environmentIdByApp, now);
    } catch (error) {
      failures.push(`Sauvegardes : ${failureMessage(error)}`);
    }
  } catch (error) {
    const message = failureMessage(error);
    await repository.finishSyncRun(db, run.id, { status: "failed", items, error: message });
    await repository.recordIntegrationCheck(db, "coolify", {
      status: statusOfFailure(error),
      checkedAt: now,
      error: message,
    });
    throw error;
  }

  const error = failures.length > 0 ? failures.slice(0, 10).join(" ; ").slice(0, 2000) : null;
  await repository.finishSyncRun(db, run.id, {
    status: failures.length > 0 ? "failed" : "succeeded",
    items,
    error,
  });
  await repository.recordIntegrationCheck(db, "coolify", {
    status: failures.length > 0 ? "degraded" : "connected",
    checkedAt: now,
    error,
  });
  return { items, failures: failures.length };
}

function statusOfFailure(error: unknown): "unavailable" | "not_configured" {
  return error instanceof ServiceUnavailableError && error.connectionRequired
    ? "not_configured"
    : "unavailable";
}

/**
 * Traite une notification déjà authentifiée. Son contenu n'est qu'un signal : on relit l'API.
 * Un déploiement a son identifiant : le reçu le traite une fois, sauf s'il a échoué. Un changement
 * d'état ou une sauvegarde n'en a pas : deux notifications proches disent deux choses, et chacune
 * est relue. Relire est sans effet si rien n'a changé.
 */
export async function handleCoolifyWebhook(
  db: Database,
  event: CoolifyWebhookEvent,
  deps: { coolify?: CoolifyGateway; now?: Date } = {},
): Promise<"processed" | "duplicate" | "ignored" | "failed"> {
  const coolify = deps.coolify ?? getCoolifyGateway();
  const now = deps.now ?? new Date();
  if (event.kind === "ignored") return "ignored";

  const receiptId =
    event.kind === "deployment"
      ? `${event.event}:${event.deploymentUuid}`
      : event.kind === "application_status"
        ? `${event.event}:${event.applicationUuid}:${now.getTime()}`
        : `${event.event}:${event.databaseUuid}:${now.getTime()}`;
  if (!(await repository.claimWebhookReceipt(db, "coolify", receiptId))) return "duplicate";

  const linked = await repository.listCoolifyLinkedEnvironments(db);
  try {
    let matched = false;
    if (event.kind === "deployment") {
      const environment = linked.find((env) => env.coolifyAppUuid === event.applicationUuid);
      const external = environment ? await coolify.getDeployment(event.deploymentUuid) : null;
      if (environment && external) {
        matched = true;
        await db.transaction((tx) =>
          applyExternalDeployment(
            tx,
            {
              environmentId: environment.id,
              siteId: environment.siteId,
              companyId: environment.companyId,
            },
            external,
            now,
          ),
        );
      }
    } else if (event.kind === "application_status") {
      const environment = linked.find((env) => env.coolifyAppUuid === event.applicationUuid);
      const application = environment ? await coolify.getApplication(event.applicationUuid) : null;
      if (environment) {
        matched = true;
        await repository.updateEnvironmentStatus(
          db,
          environment.id,
          application ? mapApplicationStatus(application.status) : "unknown",
          now,
        );
      }
    } else {
      const applications = await coolify.listApplications();
      matched =
        (await syncBackups(
          db,
          coolify,
          linked,
          new Map(
            applications.flatMap((app) =>
              app.environment_id == null ? [] : [[app.uuid, app.environment_id] as const],
            ),
          ),
          now,
        )) > 0;
    }
    const status = matched ? "processed" : "ignored";
    await repository.setWebhookReceiptStatus(db, "coolify", receiptId, status);
    return status;
  } catch (error) {
    logger.warn("coolify.webhook_failed", {
      kind: event.kind,
      code: error instanceof AppError ? error.code : "INTERNAL",
    });
    await repository.setWebhookReceiptStatus(db, "coolify", receiptId, "failed");
    return "failed";
  }
}

/** Point d'entrée de la route : la base reste hors de la couche d'interface. */
export function processCoolifyWebhook(event: CoolifyWebhookEvent) {
  return handleCoolifyWebhook(getDb(), event);
}
