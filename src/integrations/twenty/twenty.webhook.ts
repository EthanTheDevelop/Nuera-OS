import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthenticatedError, ValidationError } from "@/server/errors";
import type {
  CrmActivityLink,
  CrmCompany,
  CrmNote,
  CrmOpportunity,
  CrmPerson,
  CrmTask,
} from "./crm-gateway";
import {
  noteTargetToLink,
  taskTargetToLink,
  toCrmCompany,
  toCrmNote,
  toCrmOpportunity,
  toCrmPerson,
  toCrmTask,
} from "./twenty.mappers";
import {
  twentyCompanySchema,
  twentyNoteSchema,
  twentyNoteTargetSchema,
  twentyOpportunitySchema,
  twentyPersonSchema,
  twentyTaskSchema,
  twentyTaskTargetSchema,
  twentyWebhookPayloadSchema,
} from "./twenty.types";

/**
 * Réception des webhooks Twenty, format vérifié sur des livraisons réelles (v2.55.0) :
 *
 * - signature = HMAC-SHA256 hexadécimal de `{timestamp}:{corps brut}` ;
 * - `X-Twenty-Webhook-Timestamp` est en MILLISECONDES depuis l'époque (la documentation dit « Unix ») ;
 * - le secret est celui du webhook côté Twenty : fourni à sa création, ou généré et lisible par l'API ;
 * - un webhook sans secret n'envoie aucun de ces en-têtes : il est donc refusé ici.
 *
 * Toujours vérifier le corps BRUT reçu, avant tout `JSON.parse`.
 */

export const TWENTY_WEBHOOK_HEADERS = {
  signature: "x-twenty-webhook-signature",
  timestamp: "x-twenty-webhook-timestamp",
  nonce: "x-twenty-webhook-nonce",
} as const;

export const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type TwentyWebhookRejection = "missing_headers" | "stale_timestamp" | "invalid_signature";

export function checkTwentyWebhookSignature(params: {
  rawBody: string | Buffer;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}): { valid: true } | { valid: false; reason: TwentyWebhookRejection } {
  const { rawBody, signature, timestamp, secret } = params;
  if (!signature || !timestamp) return { valid: false, reason: "missing_headers" };

  const sentAt = /^\d{1,16}$/.test(timestamp) ? Number(timestamp) : Number.NaN;
  const toleranceMs = params.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS;
  const nowMs = params.nowMs ?? Date.now();
  if (Number.isNaN(sentAt) || Math.abs(nowMs - sentAt) > toleranceMs) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}:`).update(rawBody).digest();
  const received = /^[0-9a-f]{64}$/i.test(signature) ? Buffer.from(signature, "hex") : null;
  if (!received || !timingSafeEqual(received, expected)) {
    return { valid: false, reason: "invalid_signature" };
  }
  return { valid: true };
}

export const TWENTY_WEBHOOK_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "destroyed",
  "restored",
  "upserted",
] as const;
export type TwentyWebhookAction = (typeof TWENTY_WEBHOOK_ACTIONS)[number];

type EventBase = {
  action: TwentyWebhookAction;
  /** Nom d'origine, par exemple `company.updated`. */
  eventName: string;
  recordId: string;
  occurredAt: string;
  /** Champs Twenty modifiés (`updated`, `deleted`, `restored`) ; indicatif pour les journaux. */
  updatedFields: string[];
  webhookId: string;
  workspaceId: string;
};

export type TwentyWebhookEvent =
  | (EventBase & { entity: "company"; record: CrmCompany })
  | (EventBase & { entity: "person"; record: CrmPerson })
  | (EventBase & { entity: "opportunity"; record: CrmOpportunity })
  | (EventBase & { entity: "note"; record: Omit<CrmNote, "targets"> })
  | (EventBase & { entity: "task"; record: Omit<CrmTask, "targets"> })
  | (EventBase & { entity: "activityLink"; record: CrmActivityLink })
  /** Objet Twenty sans projection côté Nuera : à accuser réception et ignorer. */
  | (EventBase & { entity: "other"; objectName: string; record: null });

function withoutTargets<T extends { targets: unknown }>(record: T): Omit<T, "targets"> {
  const { targets: _targets, ...rest } = record;
  return rest;
}

/** Interprète un corps déjà authentifié. Lève `ValidationError` si la forme est inattendue. */
export function parseTwentyWebhookEvent(rawBody: string | Buffer): TwentyWebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString());
  } catch {
    throw new ValidationError("Corps de webhook illisible.");
  }

  const parsed = twentyWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) throw new ValidationError("Corps de webhook inattendu.");
  const payload = parsed.data;

  const action = TWENTY_WEBHOOK_ACTIONS.find(
    (candidate) => candidate === payload.eventName.split(".")[1],
  );
  if (!action) throw new ValidationError("Événement de webhook inconnu.");

  const base: EventBase = {
    action,
    eventName: payload.eventName,
    recordId: payload.record.id,
    occurredAt: payload.eventDate,
    updatedFields: payload.updatedFields ?? [],
    webhookId: payload.webhookId,
    workspaceId: payload.workspaceId,
  };

  try {
    return toEvent(base, payload.objectMetadata.nameSingular, payload.record);
  } catch (cause) {
    if (cause instanceof ValidationError) throw cause;
    throw new ValidationError("Enregistrement de webhook inattendu.");
  }
}

function toEvent(base: EventBase, objectName: string, record: unknown): TwentyWebhookEvent {
  switch (objectName) {
    case "company":
      return {
        ...base,
        entity: "company",
        record: toCrmCompany(twentyCompanySchema.parse(record)),
      };
    case "person":
      return { ...base, entity: "person", record: toCrmPerson(twentyPersonSchema.parse(record)) };
    case "opportunity":
      return {
        ...base,
        entity: "opportunity",
        record: toCrmOpportunity(twentyOpportunitySchema.parse(record)),
      };
    case "note":
      return {
        ...base,
        entity: "note",
        record: withoutTargets(toCrmNote(twentyNoteSchema.parse(record))),
      };
    case "task":
      return {
        ...base,
        entity: "task",
        record: withoutTargets(toCrmTask(twentyTaskSchema.parse(record))),
      };
    case "noteTarget":
      return {
        ...base,
        entity: "activityLink",
        record: noteTargetToLink(twentyNoteTargetSchema.parse(record)),
      };
    case "taskTarget":
      return {
        ...base,
        entity: "activityLink",
        record: taskTargetToLink(twentyTaskTargetSchema.parse(record)),
      };
    default:
      return { ...base, entity: "other", objectName, record: null };
  }
}

export class TwentyWebhookRejectedError extends UnauthenticatedError {
  constructor(readonly reason: TwentyWebhookRejection) {
    super("Webhook refusé : signature absente, expirée ou invalide.");
  }
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Point d'entrée de la future route : vérifie puis interprète.
 * `nonce` permet à l'appelant de détecter un rejeu pendant la fenêtre de tolérance.
 */
export function receiveTwentyWebhook(params: {
  rawBody: string | Buffer;
  /** `Headers`, ou objet aux clés en minuscules. */
  headers: Headers | Record<string, string | string[] | undefined>;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}): { event: TwentyWebhookEvent; nonce: string | null } {
  const check = checkTwentyWebhookSignature({
    rawBody: params.rawBody,
    signature: readHeader(params.headers, TWENTY_WEBHOOK_HEADERS.signature),
    timestamp: readHeader(params.headers, TWENTY_WEBHOOK_HEADERS.timestamp),
    secret: params.secret,
    nowMs: params.nowMs,
    toleranceMs: params.toleranceMs,
  });
  if (!check.valid) throw new TwentyWebhookRejectedError(check.reason);
  return {
    event: parseTwentyWebhookEvent(params.rawBody),
    nonce: readHeader(params.headers, TWENTY_WEBHOOK_HEADERS.nonce),
  };
}
