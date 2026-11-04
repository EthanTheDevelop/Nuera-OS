import type { DeploymentStatus, EnvironmentStatus } from "@/lib/domain-enums";

/**
 * Traductions Coolify → Nuera OS. Vérifiées dans les sources de Coolify v4 :
 * `Application::status()` compose `état:santé`, `ApplicationDeploymentStatus` fixe cinq valeurs.
 */

/**
 * `running:healthy`, `running:unknown`, `running:unhealthy`, `exited:unhealthy`, `degraded:…`,
 * `restarting:…`. Une valeur inconnue reste `unknown` : jamais d'état vert par défaut.
 */
export function mapApplicationStatus(status: string | null | undefined): EnvironmentStatus {
  const [state, health] = (status ?? "").toLowerCase().split(":");
  if (state === "running") return health === "unhealthy" ? "error" : "running";
  if (state === "exited" || state === "stopped") return "stopped";
  if (state === "degraded" || state === "failed" || state === "error") return "error";
  return "unknown";
}

const DEPLOYMENT_STATUSES: Record<string, DeploymentStatus> = {
  queued: "queued",
  in_progress: "running",
  finished: "succeeded",
  failed: "failed",
  "cancelled-by-user": "cancelled",
};

/** `null` si Coolify renvoie une valeur inconnue : la ligne locale ne change pas. */
export function mapDeploymentStatus(status: string | null | undefined): DeploymentStatus | null {
  return DEPLOYMENT_STATUSES[status ?? ""] ?? null;
}

/** `success`, `failed`, `running` : valeurs écrites par `DatabaseBackupJob`. */
export function mapBackupStatus(
  status: string | null | undefined,
): "running" | "succeeded" | "failed" | null {
  if (status === "success") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return null;
}

/** Date renvoyée par Coolify. Invalide ou absente : `null`, jamais la date du jour. */
export function parseCoolifyDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
