import { recordAudit } from "@/modules/audit/audit.service";
import { emitEvent } from "@/modules/platform/events";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { SiteBackup } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import * as repository from "./site.repository";
import { manualBackupSchema } from "./site.schema";
import { canBackupTransition } from "./site.status";

/** Sauvegardes : relues de Coolify quand une base est reliée, sinon déclarées à la main. */

const FAILED_WINDOW_MS = 7 * 86_400_000;
/** Une sauvegarde plus ancienne, découverte à la relecture, est de l'historique : pas d'alerte. */
const FRESH_FAILURE_MS = 86_400_000;

/** `backup.failed` : une seule émission par sauvegarde, quel que soit l'émetteur. */
export function backupFailedDedupeKey(backupId: string): string {
  return `backup.failed:${backupId}`;
}

export async function emitBackupFailed(
  tx: Database,
  backup: SiteBackup,
  companyId: string,
  actorId: string | null,
): Promise<void> {
  await emitEvent(tx, {
    type: "backup.failed",
    entityType: "site_backup",
    entityId: backup.id,
    companyId,
    payload: {
      siteId: backup.siteId,
      environmentId: backup.environmentId,
      takenAt: backup.takenAt?.toISOString() ?? null,
    },
    actorId,
    dedupeKey: backupFailedDedupeKey(backup.id),
  });
}

/**
 * Déclaration manuelle : `source = manual`, l'état hors serveur est celui déclaré, pas constaté.
 * Idempotente : la même déclaration renvoyée (double envoi, retour réseau) rend la ligne existante.
 */
export async function recordManualBackup(ctx: ServiceContext, input: unknown): Promise<SiteBackup> {
  assertCan(ctx.actor, "sites:update");
  const values = parseInput(manualBackupSchema, input);

  const site = await repository.findSiteById(ctx.db, values.siteId);
  if (!site) throw new NotFoundError("Site introuvable.");
  if (site.archivedAt) throw new ConflictError("Ce site est archivé.");

  if (values.environmentId) {
    const context = await repository.findEnvironmentContext(ctx.db, values.environmentId);
    if (context?.site.id !== values.siteId) {
      throw new ValidationError("Certaines informations sont invalides.", {
        environmentId: ["Cet environnement n'appartient pas à ce site."],
      });
    }
  }
  const takenAt = new Date(values.takenAt);
  if (takenAt.getTime() > Date.now() + 60_000) {
    throw new ValidationError("Certaines informations sont invalides.", {
      takenAt: ["Une sauvegarde ne peut pas être datée dans le futur."],
    });
  }

  return ctx.db.transaction(async (tx) => {
    await repository.findSiteByIdForUpdate(tx, values.siteId);
    const declared = await repository.findManualBackup(tx, {
      siteId: values.siteId,
      takenAt,
      status: values.status,
    });
    if (declared) return declared;

    const backup = await repository.insertBackup(tx, {
      siteId: values.siteId,
      environmentId: values.environmentId,
      status: values.status,
      takenAt,
      sizeBytes: values.sizeBytes,
      offSite: values.offSite,
      source: "manual",
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "site_backup.created",
      entityType: "site_backup",
      entityId: backup.id,
      metadata: { siteId: values.siteId, status: values.status, offSite: values.offSite },
    });
    if (backup.status === "failed") {
      await emitBackupFailed(tx, backup, site.companyId, ctx.actor.userId);
    }
    return backup;
  });
}

export interface ExternalBackupValues {
  externalId: string;
  status: SiteBackup["status"];
  takenAt: Date | null;
  sizeBytes: number | null;
  offSite: boolean;
}

/**
 * Écrit une sauvegarde relue de Coolify. Idempotent par `(site_id, external_id)`. Un état final
 * n'est plus modifié, sauf la copie hors serveur, qui peut arriver après. Relier une base déjà
 * ancienne n'alerte pas sur son passé : seul un échec récent est annoncé.
 */
export async function upsertExternalBackup(
  tx: Database,
  target: { siteId: string; environmentId: string; companyId: string },
  values: ExternalBackupValues,
  now: Date = new Date(),
): Promise<{ created: boolean; backup: SiteBackup }> {
  const existing = await repository.findBackupByExternalId(tx, target.siteId, values.externalId);
  if (!existing) {
    const backup = await repository.insertBackup(tx, {
      siteId: target.siteId,
      environmentId: target.environmentId,
      externalId: values.externalId,
      status: values.status,
      takenAt: values.takenAt,
      sizeBytes: values.sizeBytes,
      offSite: values.offSite,
      source: "coolify",
    });
    const isHistory =
      backup.takenAt !== null && now.getTime() - backup.takenAt.getTime() > FRESH_FAILURE_MS;
    if (backup.status === "failed" && !isHistory) {
      await emitBackupFailed(tx, backup, target.companyId, null);
    }
    return { created: true, backup };
  }

  const statusChanges =
    existing.status !== values.status && canBackupTransition(existing.status, values.status);
  if (!statusChanges && existing.offSite === values.offSite) {
    return { created: false, backup: existing };
  }
  const backup = await repository.updateBackup(tx, existing.id, {
    ...(statusChanges ? { status: values.status } : {}),
    offSite: values.offSite,
    sizeBytes: values.sizeBytes ?? existing.sizeBytes,
  });
  if (statusChanges && backup.status === "failed") {
    await emitBackupFailed(tx, backup, target.companyId, null);
  }
  return { created: false, backup };
}

/**
 * Pour les automatisations : sauvegardes en échec des 7 derniers jours, hors sites archivés.
 * L'événement `backup.failed` est déjà émis à l'enregistrement, avec `backupFailedDedupeKey` : une
 * règle qui réémet avec cette clé ne crée pas de doublon. Sans contrôle d'accès : tâche système.
 */
export async function listFailedBackups(
  db: Database,
  now: Date,
): Promise<repository.FailedBackupRow[]> {
  return repository.listFailedBackups(db, new Date(now.getTime() - FAILED_WINDOW_MS));
}
