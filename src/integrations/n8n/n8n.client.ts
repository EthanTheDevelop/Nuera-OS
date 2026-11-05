import { createHmac, timingSafeEqual } from "node:crypto";
import { ServiceUnavailableError } from "@/server/errors";

/**
 * n8n, facultatif. Le nœud Webhook (docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook)
 * ne vérifie pas de signature HMAC ; il propose Header Auth. D'où deux en-têtes sortants :
 * `x-nuera-token` pour Header Auth, et `x-nuera-signature` à vérifier avec un nœud Crypto si le
 * scénario veut garantir l'intégrité du corps. L'URL est celle de production du webhook.
 *
 * Signature des deux sens : `sha256=<hex>` de HMAC-SHA256 sur `<timestamp>.<corps brut>`.
 */
export const N8N_SERVICE = "n8n" as const;
export const N8N_SIGNATURE_HEADER = "x-nuera-signature";
export const N8N_TIMESTAMP_HEADER = "x-nuera-timestamp";
export const N8N_TOKEN_HEADER = "x-nuera-token";
/** Un corps signé plus vieux est refusé : un enregistrement rejoué ne passe pas. */
export const N8N_MAX_SIGNATURE_AGE_MS = 5 * 60_000;

const DEFAULT_TIMEOUT_MS = 10_000;

export interface N8nEvent {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  companyId: string | null;
  occurredAt: string;
  payload: unknown;
}

export interface N8nGateway {
  readonly isConfigured: boolean;
  send(event: N8nEvent): Promise<void>;
}

export function n8nNotConfigured(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    N8N_SERVICE,
    "not_configured",
    "Connexion requise : le webhook n8n n'est pas configuré.",
  );
}

export const unconfiguredN8nGateway: N8nGateway = {
  isConfigured: false,
  send: () => Promise.reject(n8nNotConfigured()),
};

export function signN8nBody(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

/** Vérifie la signature et l'âge du corps, en temps constant. */
export function checkN8nSignature(input: {
  secret: string;
  body: string;
  signature: string | null;
  timestamp: string | null;
  now?: Date;
}): boolean {
  if (!input.signature || !input.timestamp) return false;
  const at = Number(input.timestamp);
  if (!Number.isFinite(at)) return false;
  const age = Math.abs((input.now ?? new Date()).getTime() - at);
  if (age > N8N_MAX_SIGNATURE_AGE_MS) return false;
  const expected = Buffer.from(signN8nBody(input.secret, input.timestamp, input.body));
  const received = Buffer.from(input.signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export class N8nClient implements N8nGateway {
  readonly isConfigured = true;

  constructor(
    private readonly config: {
      url: string;
      secret: string;
      headerToken?: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async send(event: N8nEvent): Promise<void> {
    const body = JSON.stringify(event);
    const timestamp = String(Date.now());
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [N8N_TIMESTAMP_HEADER]: timestamp,
          [N8N_SIGNATURE_HEADER]: signN8nBody(this.config.secret, timestamp, body),
          ...(this.config.headerToken ? { [N8N_TOKEN_HEADER]: this.config.headerToken } : {}),
        },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new ServiceUnavailableError(N8N_SERVICE, "unreachable", "n8n ne répond pas.", {
        cause,
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new ServiceUnavailableError(
        N8N_SERVICE,
        "unauthorized",
        "Connexion requise : n8n refuse l'authentification du webhook.",
        { status: response.status },
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableError(
        N8N_SERVICE,
        "unreachable",
        `n8n a répondu ${response.status}. Vérifiez que le scénario est publié.`,
        { status: response.status },
      );
    }
  }
}
