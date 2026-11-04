import { getCoolifyGateway, type CoolifyGateway } from "@/integrations/coolify";
import { getUptimeKumaGateway, type UptimeKumaGateway } from "@/integrations/uptime-kuma";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { parseInput } from "@/server/validation";
import { runCoolifySync } from "./coolify-sync.service";
import { runUptimeKumaSync } from "./monitoring.service";
import * as repository from "./site.repository";
import { syncServiceSchema } from "./site.schema";

/** Point d'entrée des boutons « Synchroniser ». Les tâches planifiées appellent `run*Sync`. */

export interface SyncDeps {
  coolify?: CoolifyGateway;
  uptimeKuma?: UptimeKumaGateway;
  now?: Date;
}

export async function syncSitesNow(
  ctx: ServiceContext,
  input: unknown,
  deps: SyncDeps = {},
): Promise<{ items: number; failures: number }> {
  assertCan(ctx.actor, "sites:update");
  const { service } = parseInput(syncServiceSchema, input);

  const result =
    service === "coolify"
      ? await runCoolifySync(ctx.db, { coolify: deps.coolify, now: deps.now })
      : await runUptimeKumaSync(ctx.db, { uptimeKuma: deps.uptimeKuma, now: deps.now });

  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "site.sync_ran",
    entityType: "integration",
    metadata: { service, items: result.items, failures: result.failures },
  });
  return { items: result.items, failures: result.failures };
}

export interface ServiceState {
  configured: boolean;
  /** Dernier passage terminé, réussi ou non. */
  lastRunAt: Date | null;
  lastRunFailed: boolean;
  lastError: string | null;
  lastSuccessAt: Date | null;
}

export interface SitesIntegrationState {
  coolify: ServiceState & { consoleUrl: string | null };
  uptimeKuma: ServiceState;
}

async function serviceState(
  ctx: ServiceContext,
  service: "coolify" | "uptime_kuma",
  configured: boolean,
): Promise<ServiceState> {
  const { last, lastSuccess } = await repository.findLastSyncRuns(ctx.db, service);
  return {
    configured,
    lastRunAt: last?.finishedAt ?? last?.startedAt ?? null,
    lastRunFailed: last?.status === "failed",
    lastError: last?.error ?? null,
    lastSuccessAt: lastSuccess?.finishedAt ?? lastSuccess?.startedAt ?? null,
  };
}

/** État des connexions, pour dire ce qui est réel, daté, périmé ou absent. */
export async function getSitesIntegrationState(
  ctx: ServiceContext,
  deps: SyncDeps = {},
): Promise<SitesIntegrationState> {
  assertCan(ctx.actor, "sites:read");
  const coolify = deps.coolify ?? getCoolifyGateway();
  const uptimeKuma = deps.uptimeKuma ?? getUptimeKumaGateway();
  const [coolifyState, uptimeKumaState] = await Promise.all([
    serviceState(ctx, "coolify", coolify.isConfigured),
    serviceState(ctx, "uptime_kuma", uptimeKuma.isConfigured),
  ]);
  return {
    coolify: { ...coolifyState, consoleUrl: coolify.consoleUrl },
    uptimeKuma: uptimeKumaState,
  };
}

/** Liens vers les consoles : seulement quand l'URL et l'identifiant sont connus. */
export function getConsoleLinks(
  site: { coolifyProjectUuid: string | null; monitorId: string | null },
  deps: SyncDeps = {},
): { coolifyProject: string | null; uptimeKumaMonitor: string | null } {
  const coolify = deps.coolify ?? getCoolifyGateway();
  const uptimeKuma = deps.uptimeKuma ?? getUptimeKumaGateway();
  return {
    coolifyProject: coolify.projectUrl(site.coolifyProjectUuid),
    uptimeKumaMonitor: uptimeKuma.monitorUrl(site.monitorId),
  };
}
