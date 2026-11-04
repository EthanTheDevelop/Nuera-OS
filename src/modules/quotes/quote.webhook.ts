import "server-only";
import { getDocusealWebhookSecret } from "@/integrations/docuseal";
import {
  DocusealWebhookRejectedError,
  receiveDocusealWebhook,
} from "@/integrations/docuseal/docuseal.webhook";
import { getCrmGateway } from "@/integrations/twenty";
import { getDb } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { processDocusealWebhook } from "./quote-signature.service";

/**
 * Réception d'un webhook DocuSeal. 2xx : reçu, traité ou déjà traité. 401 : signature refusée.
 * 400 : corps illisible. 503 : secret absent ou traitement en échec ; DocuSeal rejoue pendant 48 h
 * et rien n'a été gardé.
 */
export async function handleDocusealWebhookRequest(
  rawBody: string,
  headers: Headers,
): Promise<{ status: number; body: Record<string, string> }> {
  const secret = getDocusealWebhookSecret();
  if (!secret) return { status: 503, body: { error: "Connexion requise : DocuSeal." } };

  let event: ReturnType<typeof receiveDocusealWebhook>;
  try {
    event = receiveDocusealWebhook({ rawBody, headers, secret });
  } catch (error) {
    if (error instanceof DocusealWebhookRejectedError) {
      logger.warn("docuseal.webhook_rejected", { reason: error.reason });
      return { status: 401, body: { error: error.message } };
    }
    if (error instanceof ValidationError) {
      logger.warn("docuseal.webhook_invalid");
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }

  try {
    const outcome = await processDocusealWebhook({ db: getDb(), crm: getCrmGateway() }, event);
    return { status: 200, body: { outcome } };
  } catch (error) {
    logger.error("docuseal.webhook_failed", { error });
    return { status: 503, body: { error: "Traitement impossible." } };
  }
}
