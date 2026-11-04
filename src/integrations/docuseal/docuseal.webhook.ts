import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "@/lib/zod";
import { UnauthenticatedError, ValidationError } from "@/server/errors";

/**
 * Webhooks DocuSeal, d'après la documentation officielle (« Use Webhooks », `docs/webhooks/*.md`)
 * et le code public (`lib/webhook_urls/signatures.rb`) :
 *
 * - en-tête `X-Docuseal-Signature: <timestamp>.<signature>`, timestamp en SECONDES ;
 * - signature = HMAC-SHA256 hexadécimal de `<timestamp>.<corps brut>`, clé = secret `whsec_…`
 *   tel quel, tolérance de 5 minutes ;
 * - réponse 4xx ou 5xx : nouvelles tentatives pendant 48 h (toutes les 2^n minutes). Aucun
 *   identifiant d'événement dans le corps : l'idempotence repose sur `(événement, objet)`.
 *
 * Toujours vérifier le corps BRUT, avant tout `JSON.parse`.
 */
export const DOCUSEAL_SIGNATURE_HEADER = "x-docuseal-signature";

const TOLERANCE_SECONDS = 5 * 60;

export type DocusealWebhookRejection = "missing_header" | "stale_timestamp" | "invalid_signature";

export function checkDocusealSignature(params: {
  rawBody: string;
  header: string | null | undefined;
  secret: string;
  nowMs?: number;
}): { valid: true } | { valid: false; reason: DocusealWebhookRejection } {
  const { rawBody, header, secret } = params;
  if (!header) return { valid: false, reason: "missing_header" };

  const separator = header.indexOf(".");
  if (separator <= 0) return { valid: false, reason: "invalid_signature" };
  const timestamp = header.slice(0, separator);
  const signature = header.slice(separator + 1);

  if (!/^\d{1,12}$/.test(timestamp)) return { valid: false, reason: "invalid_signature" };
  const nowSeconds = (params.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const received = /^[0-9a-f]{64}$/i.test(signature) ? Buffer.from(signature, "hex") : null;
  if (!received || !timingSafeEqual(received, expected)) {
    return { valid: false, reason: "invalid_signature" };
  }
  return { valid: true };
}

export class DocusealWebhookRejectedError extends UnauthenticatedError {
  constructor(readonly reason: DocusealWebhookRejection) {
    super("Webhook refusé : signature absente, expirée ou invalide.");
  }
}

const idSchema = z.union([z.number(), z.string()]).transform(String);

const submitterRefSchema = z.object({ external_id: z.string().nullish() });

const submissionEventSchema = z.object({
  id: idSchema,
  completed_at: z.string().nullish(),
  submitters: z.array(submitterRefSchema).default([]),
});

const formEventSchema = z.object({
  id: idSchema,
  external_id: z.string().nullish(),
  decline_reason: z.string().nullish(),
  declined_at: z.string().nullish(),
  submission: z.object({ id: idSchema }),
});

const envelopeSchema = z.object({ event_type: z.string(), data: z.unknown() });

export type DocusealWebhookEvent =
  | {
      type: "submission.completed" | "submission.expired" | "submission.archived";
      /** Clé stable : DocuSeal rejoue le même événement à l'identique en cas d'échec. */
      receiptId: string;
      submissionId: string;
      externalIds: string[];
      completedAt: Date | null;
    }
  | {
      type: "form.declined";
      receiptId: string;
      submissionId: string;
      externalIds: string[];
      declineReason: string | null;
    }
  /** Événement sans effet sur un devis : à accuser réception, sans autre traitement. */
  | { type: "ignored"; eventType: string };

/** Interprète un corps déjà authentifié. Lève `ValidationError` si sa forme est inattendue. */
export function parseDocusealWebhook(rawBody: string): DocusealWebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ValidationError("Corps de webhook illisible.");
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) throw new ValidationError("Corps de webhook inattendu.");
  const { event_type: eventType, data } = envelope.data;

  if (
    eventType === "submission.completed" ||
    eventType === "submission.expired" ||
    eventType === "submission.archived"
  ) {
    const parsed = submissionEventSchema.safeParse(data);
    if (!parsed.success) throw new ValidationError("Corps de webhook inattendu.");
    return {
      type: eventType,
      receiptId: `${eventType}:${parsed.data.id}`,
      submissionId: parsed.data.id,
      externalIds: parsed.data.submitters.flatMap((submitter) =>
        submitter.external_id ? [submitter.external_id] : [],
      ),
      completedAt: parsed.data.completed_at ? new Date(parsed.data.completed_at) : null,
    };
  }

  if (eventType === "form.declined") {
    const parsed = formEventSchema.safeParse(data);
    if (!parsed.success) throw new ValidationError("Corps de webhook inattendu.");
    return {
      type: eventType,
      receiptId: `${eventType}:${parsed.data.id}`,
      submissionId: parsed.data.submission.id,
      externalIds: parsed.data.external_id ? [parsed.data.external_id] : [],
      declineReason: parsed.data.decline_reason ?? null,
    };
  }

  return { type: "ignored", eventType };
}

/** Point d'entrée de la route : vérifie puis interprète. */
export function receiveDocusealWebhook(params: {
  rawBody: string;
  headers: Headers;
  secret: string;
  nowMs?: number;
}): DocusealWebhookEvent {
  const check = checkDocusealSignature({
    rawBody: params.rawBody,
    header: params.headers.get(DOCUSEAL_SIGNATURE_HEADER),
    secret: params.secret,
    nowMs: params.nowMs,
  });
  if (!check.valid) throw new DocusealWebhookRejectedError(check.reason);
  return parseDocusealWebhook(params.rawBody);
}
