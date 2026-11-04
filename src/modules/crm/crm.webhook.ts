import "server-only";
import { getCrmGateway } from "@/integrations/twenty";
import { TwentyWebhookRejectedError } from "@/integrations/twenty/twenty.webhook";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { handleTwentyWebhook, type CrmSyncDeps } from "./crm.sync.service";

const MAX_BODY_BYTES = 1_000_000;

export interface WebhookResponse {
  status: number;
  body: { outcome?: string; error?: string };
}

/**
 * Traduit la réception en réponse HTTP. Twenty ne relivre jamais : un échec reste consigné et la
 * réconciliation rattrape. Sans secret, la route n'existe pas : aucun corps n'est lu ni écrit.
 */
export async function respondToTwentyWebhook(
  deps: CrmSyncDeps,
  input: { rawBody: string; headers: Headers; secret: string | undefined; nowMs?: number },
): Promise<WebhookResponse> {
  if (!input.secret) return { status: 404, body: { error: "not_configured" } };
  if (Buffer.byteLength(input.rawBody) > MAX_BODY_BYTES) {
    return { status: 413, body: { error: "too_large" } };
  }
  try {
    const outcome = await handleTwentyWebhook(deps, {
      rawBody: input.rawBody,
      headers: input.headers,
      secret: input.secret,
      nowMs: input.nowMs,
    });
    return { status: outcome === "failed" ? 500 : 200, body: { outcome } };
  } catch (error) {
    if (error instanceof TwentyWebhookRejectedError) {
      return { status: 401, body: { error: "invalid_signature" } };
    }
    if (error instanceof ValidationError) return { status: 400, body: { error: "invalid_body" } };
    throw error;
  }
}

/** Point d'entrée de la route : le corps doit arriver brut, la signature porte sur ses octets. */
export function handleTwentyWebhookRequest(
  rawBody: string,
  headers: Headers,
): Promise<WebhookResponse> {
  return respondToTwentyWebhook(
    { db: getDb(), crm: getCrmGateway() },
    { rawBody, headers, secret: getEnv().TWENTY_WEBHOOK_SECRET },
  );
}
