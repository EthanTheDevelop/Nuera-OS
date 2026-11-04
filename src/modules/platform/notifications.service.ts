import type { NotificationSeverity } from "@/lib/domain-enums";
import type { Role } from "@/server/auth/roles";
import type { Database } from "@/server/db/types";

/** Destinataires : des comptes précis ou tous les comptes d'un rôle. */
export type NotifyRecipients =
  { userIds: readonly string[]; role?: never } | { role: Role; userIds?: never };

export type NotifyInput = NotifyRecipients & {
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Unique par destinataire : la même alerte ne se répète pas (parcours 5). */
  dedupeKey: string;
};

/** Crée les notifications dans la transaction de l'opération, sans doublon. */
export async function notify(_tx: Database, _input: NotifyInput): Promise<void> {
  throw new Error(
    "notify n'est pas implémenté : à livrer par le lot Automatisations et administration.",
  );
}
