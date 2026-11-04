import "server-only";
import { IntegrationError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Client HTTP de Twenty : délais, nouvelles tentatives et erreurs typées.
 *
 * Sur erreur réseau ou 5xx, seules les requêtes idempotentes sont rejouées (GET, PATCH, DELETE, et
 * POST explicitement marqués : création avec identifiant fourni par le client). Sur 429, tout est
 * rejoué : Twenty n'a rien traité. La clé d'API et les paramètres de requête (qui peuvent contenir
 * un e-mail) ne sont jamais journalisés.
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type TwentyClientConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  /** Au-delà de cette attente demandée par Twenty, la requête échoue au lieu de bloquer l'appelant. */
  maxRetryAfterMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type TwentyRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Vrai par défaut, sauf pour POST. POST avec identifiant client : `true` ; fusion : `false`. */
  idempotent?: boolean;
};

/** Réponse HTTP d'erreur de Twenty. `messages` est technique (anglais) : jamais pour l'utilisateur. */
export class TwentyApiError extends IntegrationError {
  constructor(
    status: number,
    readonly messages: string[],
    readonly twentyCode: string | undefined,
    readonly attempts: number,
    readonly retryAfterMs: number | undefined,
  ) {
    super("twenty", "Le CRM a refusé cette opération.", { status });
  }
}

/** Twenty n'a pas répondu (réseau, délai dépassé). */
export class TwentyNetworkError extends IntegrationError {
  constructor(
    readonly attempts: number,
    cause: unknown,
  ) {
    super("twenty", "Le CRM ne répond pas.", { cause });
  }
}

function parseRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function parseSuccessBody(raw: string): unknown {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new IntegrationError("twenty", "Réponse illisible du CRM.", { cause });
  }
}

function parseErrorBody(raw: string): { messages: string[]; code: string | undefined } {
  try {
    const body = JSON.parse(raw) as { messages?: unknown; code?: unknown; error?: unknown };
    const messages = Array.isArray(body.messages)
      ? body.messages.filter((message): message is string => typeof message === "string")
      : [];
    const code =
      typeof body.code === "string"
        ? body.code
        : typeof body.error === "string"
          ? body.error
          : undefined;
    return { messages, code };
  } catch {
    return { messages: [], code: undefined };
  }
}

export class TwentyClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: TwentyClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 300;
    this.maxRetryAfterMs = config.maxRetryAfterMs ?? 5_000;
    this.fetchImpl = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Renvoie le corps JSON de la réponse, non typé : la validation revient à l'appelant. */
  async request(request: TwentyRequest): Promise<unknown> {
    const url = this.buildUrl(request);
    const canRetry = request.idempotent ?? request.method !== "POST";

    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      let raw: string;
      try {
        response = await this.fetchImpl(url, {
          method: request.method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        raw = await response.text();
      } catch (cause) {
        if (!canRetry || attempt > this.maxRetries) throw new TwentyNetworkError(attempt, cause);
        await this.waitBeforeRetry(request, attempt, undefined, undefined);
        continue;
      }

      if (response.ok) return parseSuccessBody(raw);

      // 429 : Twenty n'a rien traité, le rejeu est sûr même pour un POST non idempotent.
      const retryAfterMs = parseRetryAfterMs(response);
      const isRetryable =
        (canRetry || response.status === 429) &&
        RETRYABLE_STATUS.has(response.status) &&
        attempt <= this.maxRetries &&
        (retryAfterMs === undefined || retryAfterMs <= this.maxRetryAfterMs);

      if (!isRetryable) {
        const { messages, code } = parseErrorBody(raw);
        throw new TwentyApiError(response.status, messages, code, attempt, retryAfterMs);
      }
      await this.waitBeforeRetry(request, attempt, response.status, retryAfterMs);
    }
  }

  /** Point d'accès public, sans clé d'API (état de santé). */
  publicGet(path: string): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
  }

  private buildUrl({ path, query }: TwentyRequest): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async waitBeforeRetry(
    request: TwentyRequest,
    attempt: number,
    status: number | undefined,
    retryAfterMs: number | undefined,
  ): Promise<void> {
    const backoff = this.baseDelayMs * 2 ** (attempt - 1);
    const delayMs = Math.max(retryAfterMs ?? 0, backoff + Math.random() * this.baseDelayMs);
    logger.warn("twenty.request_retry", {
      method: request.method,
      path: request.path,
      status,
      attempt,
      delayMs: Math.round(delayMs),
    });
    await this.sleep(delayMs);
  }
}
