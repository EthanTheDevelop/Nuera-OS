import {
  BACKUP_STATUS_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  SITE_STATUS_LABELS,
  type BackupStatus,
  type DeploymentStatus,
  type SiteStatus,
} from "@/lib/domain-enums";
import { assertTransition, canTransition, type TransitionTable } from "@/server/status-machine";

/**
 * Machines à états du domaine Sites. Fichier pur : l'interface s'en sert pour proposer les actions
 * possibles, le service reste seul à faire foi.
 *
 * `archived → paused` : un archivage reste réversible, la restauration repart d'un site en pause.
 */
export const SITE_TRANSITIONS: TransitionTable<SiteStatus> = {
  planned: ["staging", "live", "archived"],
  staging: ["live", "paused", "archived"],
  live: ["staging", "paused", "archived"],
  paused: ["staging", "live", "archived"],
  archived: ["paused"],
};

export function assertSiteTransition(from: SiteStatus, to: SiteStatus): void {
  assertTransition(SITE_TRANSITIONS, from, to, SITE_STATUS_LABELS);
}

/** Un état final ne change plus : une relecture ancienne de Coolify ne l'écrase pas. */
export const DEPLOYMENT_TRANSITIONS: TransitionTable<DeploymentStatus> = {
  queued: ["running", "succeeded", "failed", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const DEPLOYMENT_FINAL_STATUSES: readonly DeploymentStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export function isDeploymentFinal(status: DeploymentStatus): boolean {
  return DEPLOYMENT_FINAL_STATUSES.includes(status);
}

export function canDeploymentTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return canTransition(DEPLOYMENT_TRANSITIONS, from, to);
}

export function assertDeploymentTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  assertTransition(DEPLOYMENT_TRANSITIONS, from, to, DEPLOYMENT_STATUS_LABELS);
}

export const BACKUP_TRANSITIONS: TransitionTable<BackupStatus> = {
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export function canBackupTransition(from: BackupStatus, to: BackupStatus): boolean {
  return canTransition(BACKUP_TRANSITIONS, from, to);
}

export function assertBackupTransition(from: BackupStatus, to: BackupStatus): void {
  assertTransition(BACKUP_TRANSITIONS, from, to, BACKUP_STATUS_LABELS);
}
