import "server-only";
import { z } from "@/lib/zod";
import { IntegrationError, ServiceUnavailableError } from "@/server/errors";

/**
 * Adaptateur DocuSeal (API REST officielle : https://www.docuseal.com/docs/api et
 * `docs/openapi.json` du dépôt docusealco/docuseal). Authentification par l'en-tête `X-Auth-Token`.
 *
 * Seules les opérations utiles aux devis sont exposées :
 * - `POST /submissions/html` : demande de signature à partir d'un document HTML ;
 * - `GET /submissions/{id}` : relecture de l'état ;
 * - `GET /submissions/{id}/documents` : document signé, à une adresse à durée de vie limitée ;
 * - `DELETE /submissions/{id}` : archivage d'une demande devenue caduque.
 *
 * Jamais de nouvelle tentative automatique sur la création : un POST rejoué enverrait un second
 * e-mail au client. La clé d'API n'est jamais journalisée.
 */
export const DOCUSEAL_SERVICE = "DocuSeal";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Levée par tout appel sans configuration, et par le service avant d'écrire quoi que ce soit. */
export function docusealNotConfigured(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    DOCUSEAL_SERVICE,
    "not_configured",
    "Connexion requise : l'adresse et la clé d'API de DocuSeal ne sont pas renseignées.",
  );
}

export type DocusealSubmissionStatus = "completed" | "declined" | "expired" | "pending";

export interface DocusealSubmitter {
  id: string;
  email: string | null;
  externalId: string | null;
  status: string;
}

export interface DocusealSubmission {
  id: string;
  status: DocusealSubmissionStatus;
  completedAt: Date | null;
  submitters: DocusealSubmitter[];
}

export interface CreateSubmissionInput {
  /** Nom de la demande, visible dans DocuSeal. */
  name: string;
  document: { name: string; html: string };
  submitter: {
    role: string;
    name: string;
    email: string;
    /** Clé propre à Nuera OS, renvoyée telle quelle par les webhooks. */
    externalId: string;
  };
  /** Date limite de signature. */
  expireAt?: Date | null;
}

/** Document d'une demande. Son adresse expire vite (40 min par défaut) : la relire à chaque usage. */
export interface DocusealDocument {
  name: string;
  url: string;
}

/** Port appelé par les services. Les tests lui passent un client branché sur un serveur local. */
export interface DocusealGateway {
  readonly isConfigured: boolean;
  createSubmission(input: CreateSubmissionInput): Promise<DocusealSubmission>;
  getSubmission(submissionId: string): Promise<DocusealSubmission>;
  getSubmissionDocuments(submissionId: string): Promise<DocusealDocument[]>;
  archiveSubmission(submissionId: string): Promise<void>;
}

const idSchema = z.union([z.number(), z.string()]).transform(String);

const submissionSchema = z.object({
  id: idSchema,
  status: z.enum(["completed", "declined", "expired", "pending"]).catch("pending"),
  completed_at: z.string().nullish(),
  submitters: z
    .array(
      z.object({
        id: idSchema,
        email: z.string().nullish(),
        external_id: z.string().nullish(),
        status: z.string().nullish(),
      }),
    )
    .default([]),
});

const documentsSchema = z.object({
  documents: z.array(z.object({ name: z.string(), url: z.url({ protocol: /^https?$/ }) })),
});

function toSubmission(payload: unknown): DocusealSubmission {
  const parsed = submissionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new IntegrationError(DOCUSEAL_SERVICE, "DocuSeal a renvoyé une réponse inattendue.");
  }
  const { id, status, completed_at: completedAt, submitters } = parsed.data;
  return {
    id,
    status,
    completedAt: completedAt ? new Date(completedAt) : null,
    submitters: submitters.map((submitter) => ({
      id: submitter.id,
      email: submitter.email ?? null,
      externalId: submitter.external_id ?? null,
      status: submitter.status ?? "awaiting",
    })),
  };
}

/** Format documenté de `expire_at` : `2024-09-01 12:00:00 UTC`. */
function formatExpireAt(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export class DocusealClient implements DocusealGateway {
  readonly isConfigured = true;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: {
    /** `https://api.docuseal.com`, `https://api.docuseal.eu` ou l'URL de l'API auto-hébergée. */
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? fetch;
  }

  private async request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "X-Auth-Token": this.apiKey,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new ServiceUnavailableError(
        DOCUSEAL_SERVICE,
        "unreachable",
        "DocuSeal ne répond pas. Réessayez, ou enregistrez la signature manuellement.",
        { cause },
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ServiceUnavailableError(
        DOCUSEAL_SERVICE,
        "unauthorized",
        "Connexion requise : DocuSeal refuse la clé d'API configurée.",
        { status: response.status },
      );
    }
    if (response.status === 429) {
      throw new ServiceUnavailableError(
        DOCUSEAL_SERVICE,
        "rate_limited",
        "DocuSeal limite les demandes pour le moment. Réessayez dans quelques minutes.",
        { status: response.status },
      );
    }
    if (response.status >= 500) {
      throw new ServiceUnavailableError(
        DOCUSEAL_SERVICE,
        "unreachable",
        "DocuSeal est indisponible. Réessayez, ou enregistrez la signature manuellement.",
        { status: response.status },
      );
    }
    if (!response.ok) {
      throw new IntegrationError(DOCUSEAL_SERVICE, "DocuSeal a refusé cette demande.", {
        status: response.status,
      });
    }
    return response;
  }

  async createSubmission(input: CreateSubmissionInput): Promise<DocusealSubmission> {
    const response = await this.request("POST", "/submissions/html", {
      name: input.name,
      send_email: true,
      documents: [{ name: input.document.name, html: input.document.html, size: "A4" }],
      submitters: [
        {
          role: input.submitter.role,
          name: input.submitter.name,
          email: input.submitter.email,
          external_id: input.submitter.externalId,
        },
      ],
      ...(input.expireAt ? { expire_at: formatExpireAt(input.expireAt) } : {}),
    });
    return toSubmission(await response.json());
  }

  async getSubmission(submissionId: string): Promise<DocusealSubmission> {
    const response = await this.request("GET", `/submissions/${encodeURIComponent(submissionId)}`);
    return toSubmission(await response.json());
  }

  /** Une demande terminée rend ici les documents signés, réunis en un seul PDF. */
  async getSubmissionDocuments(submissionId: string): Promise<DocusealDocument[]> {
    const response = await this.request(
      "GET",
      `/submissions/${encodeURIComponent(submissionId)}/documents?merge=true`,
    );
    const parsed = documentsSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new IntegrationError(DOCUSEAL_SERVICE, "DocuSeal a renvoyé une réponse inattendue.");
    }
    return parsed.data.documents;
  }

  async archiveSubmission(submissionId: string): Promise<void> {
    await this.request("DELETE", `/submissions/${encodeURIComponent(submissionId)}`);
  }
}
