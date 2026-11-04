import { sql } from "drizzle-orm";
import {
  getCoolifyGateway,
  type CoolifyDeployment,
  type CoolifyGateway,
} from "@/integrations/coolify";
import { mapDeploymentStatus, parseCoolifyDate } from "@/integrations/coolify/coolify.mappers";
import { recordAudit } from "@/modules/audit/audit.service";
import { emitEvent } from "@/modules/platform/events";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Deployment } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { PageParams, Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { z } from "@/lib/zod";
import * as repository from "./site.repository";
import {
  PRODUCTION_CONFIRMATION_WORD,
  SIMPLE_CONFIRMATION,
  siteIdSchema,
  triggerDeploymentSchema,
} from "./site.schema";
import { canDeploymentTransition, isDeploymentFinal } from "./site.status";

export type { DeploymentRow } from "./site.repository";

/** Un déploiement resté actif plus longtemps ne bloque plus le suivant. */
const ACTIVE_WINDOW_MS = 2 * 3_600_000;
/** Un déploiement déjà fini, découvert plus tard que cela, est de l'historique : pas d'annonce. */
const FRESH_FINISH_MS = 86_400_000;

export async function listSiteDeployments(
  ctx: ServiceContext,
  rawSiteId: unknown,
  params: PageParams,
): Promise<Paginated<repository.DeploymentRow>> {
  assertCan(ctx.actor, "deployments:read");
  const { id } = parseInput(siteIdSchema, { id: rawSiteId });
  const site = await repository.findSiteById(ctx.db, id);
  if (!site) throw new NotFoundError("Site introuvable.");
  return repository.listSiteDeployments(ctx.db, id, params);
}

/**
 * Déclenche un déploiement par l'API officielle (`POST /deploy`).
 *
 * Le serveur exige lui-même la confirmation : le mot `PRODUCTION` en production, un accusé sinon.
 * Une réservation est écrite avant l'appel, sous verrou par environnement : deux clics ou deux
 * personnes ne lancent pas deux déploiements. Tout est audité, y compris un refus de Coolify.
 */
export async function triggerDeployment(
  ctx: ServiceContext,
  input: unknown,
  deps: { coolify?: CoolifyGateway; now?: Date } = {},
): Promise<Deployment> {
  assertCan(ctx.actor, "deployments:trigger");
  const { environmentId, confirmation } = parseInput(triggerDeploymentSchema, input);
  const coolify = deps.coolify ?? getCoolifyGateway();
  const now = deps.now ?? new Date();

  const context = await repository.findEnvironmentContext(ctx.db, environmentId);
  if (!context) throw new NotFoundError("Environnement introuvable.");
  const { environment, site } = context;

  const expected =
    environment.kind === "production" ? PRODUCTION_CONFIRMATION_WORD : SIMPLE_CONFIRMATION;
  if (confirmation !== expected) {
    throw new ValidationError(
      environment.kind === "production"
        ? `Pour déployer en production, saisissez ${PRODUCTION_CONFIRMATION_WORD}.`
        : "Ce déploiement doit être confirmé.",
      { confirmation: ["Confirmation manquante."] },
    );
  }
  if (site.archivedAt) throw new ConflictError("Ce site est archivé.");
  if (!environment.coolifyAppUuid) {
    throw new ConflictError("Cet environnement n'est relié à aucune application Coolify.");
  }

  // Avant toute écriture : sans connexion, rien ne doit laisser croire qu'un envoi a eu lieu.
  if (!coolify.isConfigured) await coolify.deployApplication(environment.coolifyAppUuid);

  const reservation = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${environment.id}, 0))`);
    const active = await repository.findActiveDeployment(
      tx,
      environment.id,
      new Date(now.getTime() - ACTIVE_WINDOW_MS),
    );
    if (active) throw new ConflictError("Un déploiement est déjà en cours sur cet environnement.");

    const row = await repository.insertDeployment(tx, {
      environmentId: environment.id,
      status: "queued",
      triggeredByUserId: ctx.actor.userId,
      startedAt: now,
      source: "nuera",
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "deployment.triggered",
      entityType: "deployment",
      entityId: row.id,
      metadata: {
        siteId: site.id,
        environmentId: environment.id,
        environmentKind: environment.kind,
        production: environment.kind === "production",
        confirmedWord: environment.kind === "production",
      },
    });
    return row;
  });

  let deploymentUuid: string;
  try {
    ({ deploymentUuid } = await coolify.deployApplication(environment.coolifyAppUuid));
  } catch (error) {
    await ctx.db.transaction(async (tx) => {
      await repository.updateDeployment(tx, reservation.id, {
        status: "failed",
        finishedAt: new Date(),
        durationSeconds: 0,
      });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "deployment.trigger_failed",
        entityType: "deployment",
        entityId: reservation.id,
        metadata: {
          siteId: site.id,
          environmentKind: environment.kind,
          code: error instanceof AppError ? error.code : "INTERNAL",
        },
      });
    });
    throw error;
  }

  return ctx.db.transaction(async (tx) => {
    // Le webhook ou une synchronisation a pu écrire ce déploiement entre-temps : on fusionne.
    const existing = await repository.findDeploymentByExternalId(tx, deploymentUuid);
    if (existing) {
      await repository.deleteDeployment(tx, reservation.id);
      return repository.updateDeployment(tx, existing.id, {
        triggeredByUserId: ctx.actor.userId,
        source: "nuera",
      });
    }
    return repository.updateDeployment(tx, reservation.id, { externalId: deploymentUuid });
  });
}

/**
 * Environnements dont un déploiement connu de Coolify est en cours : état du bouton et suivi. Même
 * fenêtre que le verrou du déclenchement : une ligne restée active au-delà n'occupe plus rien.
 */
export async function listBusyEnvironmentIds(
  ctx: ServiceContext,
  rawSiteId: unknown,
  now: Date = new Date(),
): Promise<string[]> {
  assertCan(ctx.actor, "deployments:read");
  const { id } = parseInput(siteIdSchema, { id: rawSiteId });
  const active = await repository.listActiveSiteDeployments(ctx.db, id);
  const since = now.getTime() - ACTIVE_WINDOW_MS;
  return [
    ...new Set(
      active
        .filter((row) => (row.startedAt ?? row.createdAt).getTime() >= since)
        .map((row) => row.environmentId),
    ),
  ];
}

export interface DeploymentTarget {
  environmentId: string;
  siteId: string;
  companyId: string;
}

/**
 * Applique une relecture de Coolify à la ligne locale. Idempotent : une relecture identique ne
 * change rien et `deployment.finished` part une seule fois. Un état final n'est jamais écrasé.
 * Relier une application déjà ancienne n'annonce pas son passé : un déploiement découvert fini
 * depuis plus de 24 h entre dans l'historique sans événement.
 */
export async function applyExternalDeployment(
  tx: Database,
  target: DeploymentTarget,
  external: CoolifyDeployment,
  now: Date = new Date(),
): Promise<{ created: boolean; changed: boolean }> {
  const status = mapDeploymentStatus(external.status);
  if (!status) {
    logger.warn("coolify.unknown_deployment_status", { status: external.status });
    return { created: false, changed: false };
  }

  const startedAt = parseCoolifyDate(external.created_at);
  const finishedAt = isDeploymentFinal(status) ? parseCoolifyDate(external.updated_at) : null;
  const durationSeconds =
    startedAt && finishedAt
      ? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
      : null;
  const details = {
    commitSha: external.commit && external.commit !== "HEAD" ? external.commit.slice(0, 40) : null,
    commitMessage: external.commit_message?.split("\n")[0]?.slice(0, 500) ?? null,
  };

  const existing = await repository.findDeploymentByExternalId(tx, external.deployment_uuid);
  if (!existing) {
    const row = await repository.insertDeployment(tx, {
      environmentId: target.environmentId,
      externalId: external.deployment_uuid,
      status,
      startedAt,
      finishedAt,
      durationSeconds,
      source: "coolify",
      ...details,
    });
    const isHistory = finishedAt && now.getTime() - finishedAt.getTime() > FRESH_FINISH_MS;
    if (isDeploymentFinal(status) && !isHistory) await emitFinished(tx, target, row);
    return { created: true, changed: true };
  }

  const missingDetails =
    (!existing.commitSha && details.commitSha) ||
    (!existing.commitMessage && details.commitMessage);
  const moves = existing.status !== status && canDeploymentTransition(existing.status, status);
  if (!moves && !missingDetails) return { created: false, changed: false };

  const row = await repository.updateDeployment(tx, existing.id, {
    commitSha: existing.commitSha ?? details.commitSha,
    commitMessage: existing.commitMessage ?? details.commitMessage,
    ...(moves ? { status, finishedAt, durationSeconds } : {}),
  });
  if (moves && isDeploymentFinal(status)) await emitFinished(tx, target, row);
  return { created: false, changed: true };
}

async function emitFinished(
  tx: Database,
  target: DeploymentTarget,
  deployment: Deployment,
): Promise<void> {
  await emitEvent(tx, {
    type: "deployment.finished",
    entityType: "deployment",
    entityId: deployment.id,
    companyId: target.companyId,
    payload: {
      siteId: target.siteId,
      environmentId: target.environmentId,
      status: deployment.status,
      source: deployment.source,
    },
    actorId: null,
    dedupeKey: `deployment.finished:${deployment.id}`,
  });
}

/**
 * Suivi de la fiche : relit les déploiements en cours d'un site. Renvoie vrai s'il en reste.
 * Coolify injoignable : l'état local reste affiché, sans rien inventer.
 */
export async function refreshSiteDeployments(
  ctx: ServiceContext,
  rawSiteId: unknown,
  deps: { coolify?: CoolifyGateway } = {},
): Promise<{ active: boolean; changed: boolean }> {
  assertCan(ctx.actor, "deployments:read");
  const { id } = parseInput(z.object({ id: z.uuid() }), { id: rawSiteId });
  const coolify = deps.coolify ?? getCoolifyGateway();

  const active = await repository.listActiveSiteDeployments(ctx.db, id);
  if (active.length === 0) return { active: false, changed: false };
  if (!coolify.isConfigured) return { active: true, changed: false };

  let changed = false;
  let remaining = 0;
  for (const deployment of active) {
    if (!deployment.externalId) continue;
    try {
      const external = await coolify.getDeployment(deployment.externalId);
      if (!external) {
        remaining += 1;
        continue;
      }
      const result = await ctx.db.transaction((tx) =>
        applyExternalDeployment(
          tx,
          {
            environmentId: deployment.environmentId,
            siteId: deployment.siteId,
            companyId: deployment.companyId,
          },
          external,
        ),
      );
      changed = changed || result.changed;
      const status = mapDeploymentStatus(external.status);
      if (!status || !isDeploymentFinal(status)) remaining += 1;
    } catch (error) {
      logger.warn("sites.deployment_refresh_failed", {
        deploymentId: deployment.id,
        code: error instanceof AppError ? error.code : "INTERNAL",
      });
      remaining += 1;
    }
  }
  return { active: remaining > 0, changed };
}
