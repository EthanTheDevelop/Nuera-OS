import "server-only";
import { getSmtpGateway } from "@/integrations/smtp";
import type { Database } from "@/server/db/types";
import { logger } from "@/server/logger";
import { drainEmailOutbox } from "./email-outbox";

/**
 * Envoi immédiat, sans attendre : la réponse HTTP ne révèle rien par sa durée. Un échec reste en
 * boîte, la tâche `emails-drain` le reprend.
 */
export function kickEmailOutbox(db: Database): void {
  void drainEmailOutbox(db, getSmtpGateway(), { limit: 5 }).catch((error: unknown) =>
    logger.warn("email.kick_failed", { error }),
  );
}
