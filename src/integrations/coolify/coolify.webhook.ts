import { timingSafeEqual } from "node:crypto";
import { z } from "@/lib/zod";

/**
 * Notification webhook de Coolify (`core/notifications/channels/webhook/payload-reference`).
 * Elle n'est ni signée ni porteuse d'en-tête : l'authentification passe par un secret dans l'URL.
 * Son contenu n'est qu'un signal : le service relit toujours l'état réel par l'API.
 */
const payloadSchema = z.object({
  event: z.string(),
  success: z.boolean().nullish(),
  application_uuid: z.string().nullish(),
  deployment_uuid: z.string().nullish(),
  database_uuid: z.string().nullish(),
});

export type CoolifyWebhookEvent =
  | { kind: "deployment"; deploymentUuid: string; applicationUuid: string; event: string }
  | { kind: "application_status"; applicationUuid: string; event: string }
  | { kind: "backup"; databaseUuid: string; event: string }
  | { kind: "ignored"; event: string };

const BACKUP_EVENTS = new Set([
  "backup_success",
  "backup_failed",
  "backup_success_with_s3_warning",
]);

/** `null` si le corps n'a pas la forme d'une notification. */
export function parseCoolifyWebhook(body: unknown): CoolifyWebhookEvent | null {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return null;
  const { event, deployment_uuid, application_uuid, database_uuid } = parsed.data;

  if (
    (event === "deployment_success" || event === "deployment_failed") &&
    deployment_uuid &&
    application_uuid
  ) {
    return {
      kind: "deployment",
      deploymentUuid: deployment_uuid,
      applicationUuid: application_uuid,
      event,
    };
  }
  if ((event === "status_changed" || event === "restart_limit_reached") && application_uuid) {
    return { kind: "application_status", applicationUuid: application_uuid, event };
  }
  if (BACKUP_EVENTS.has(event) && database_uuid) {
    return { kind: "backup", databaseUuid: database_uuid, event };
  }
  return { kind: "ignored", event };
}

/** Comparaison à temps constant d'un secret reçu. Sans secret configuré : toujours faux. */
export function isValidWebhookToken(
  received: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
