import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database } from "@/server/db/types";
import { logger } from "@/server/logger";
import { calWebhookSchema } from "./appointment.schema";
import { applyCalWebhook, type CalWebhookOutcome } from "./appointment.service";

/**
 * Signature d'un webhook Cal.com / Cal.diy : en-tête `x-cal-signature-256`, HMAC-SHA256 du corps
 * brut avec le secret du webhook, en hexadécimal (documentation officielle et code de Cal.com :
 * `createHmac("sha256", secret).update(body).digest("hex")`). Sans secret côté Cal, l'en-tête vaut
 * `no-secret-provided` : la comparaison échoue, l'envoi est refusé.
 */
export const CAL_SIGNATURE_HEADER = "x-cal-signature-256";

export function signCalBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyCalSignature(
  secret: string,
  body: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signCalBody(secret, body), "utf8");
  const received = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface CalWebhookResponse {
  status: number;
  body: { outcome: CalWebhookOutcome } | { error: string };
}

/**
 * Traitement d'un envoi Cal. Sans secret configuré, la route n'existe pas (404). La signature est
 * vérifiée sur le corps brut avant toute lecture. Une erreur interne répond 500 : Cal peut relivrer,
 * et l'accusé de réception a été annulé avec la transaction.
 */
export async function processCalWebhook(
  db: Database,
  secret: string | undefined,
  rawBody: string,
  signature: string | null,
): Promise<CalWebhookResponse> {
  if (!secret) return { status: 404, body: { error: "not_found" } };
  if (!verifyCalSignature(secret, rawBody, signature)) {
    logger.warn("cal.webhook_rejected", { reason: "signature" });
    return { status: 401, body: { error: "invalid_signature" } };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_body" } };
  }
  const parsed = calWebhookSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };

  try {
    const outcome = await applyCalWebhook(db, parsed.data);
    logger.info("cal.webhook_applied", { trigger: parsed.data.triggerEvent, outcome });
    return { status: 200, body: { outcome } };
  } catch (error) {
    logger.error("cal.webhook_failed", { trigger: parsed.data.triggerEvent, error });
    return { status: 500, body: { error: "internal" } };
  }
}
