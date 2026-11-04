import { IntegrationError, ServiceUnavailableError } from "@/server/errors";

/**
 * Client minimal de l'API Responses d'OpenAI (`POST /v1/responses`), d'après la documentation
 * officielle : authentification `Authorization: Bearer`, corps `model`, `instructions`, `input`,
 * `max_output_tokens`, `store`. Le texte se lit dans `output[].content[]` (`type: "output_text"`) :
 * `output_text` n'est qu'un raccourci des SDK, absent de la réponse HTTP.
 *
 * `store: false` : la réponse n'est pas conservée par OpenAI pour une lecture ultérieure.
 */
export const OPENAI_SERVICE = "openai";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 20_000;

export const OPENAI_NOT_CONFIGURED_MESSAGE =
  "Connexion requise : la clé OpenAI ou le modèle n'est pas renseigné.";

export interface OpenAiClientConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface GenerateTextInput {
  instructions: string;
  input: string;
  maxOutputTokens: number;
}

export interface GeneratedText {
  text: string;
  model: string;
}

/** Port utilisé par les services : un faux ou un serveur local le remplacent dans les tests. */
export interface TextGenerator {
  readonly isConfigured: boolean;
  generate(input: GenerateTextInput): Promise<GeneratedText>;
}

interface ResponsesApiBody {
  status?: string;
  error?: { code?: string; message?: string } | null;
  model?: string;
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
  }[];
}

function readOutputText(body: ResponsesApiBody): string {
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("").trim();
}

export class OpenAiClient implements TextGenerator {
  readonly isConfigured = true;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: OpenAiClientConfig) {
    this.baseUrl = (config.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = config.fetch ?? fetch;
  }

  async generate({
    instructions,
    input,
    maxOutputTokens,
  }: GenerateTextInput): Promise<GeneratedText> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          instructions,
          input,
          max_output_tokens: maxOutputTokens,
          store: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new ServiceUnavailableError(
        OPENAI_SERVICE,
        "unreachable",
        "OpenAI ne répond pas pour le moment. Réessayez dans un instant.",
        { cause },
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ServiceUnavailableError(
        OPENAI_SERVICE,
        "unauthorized",
        "Connexion requise : OpenAI refuse la clé configurée.",
        { status: response.status },
      );
    }
    if (response.status === 429) {
      throw new ServiceUnavailableError(
        OPENAI_SERVICE,
        "rate_limited",
        "OpenAI limite les demandes pour le moment. Réessayez dans un instant.",
        { status: response.status },
      );
    }
    if (response.status >= 500) {
      throw new ServiceUnavailableError(
        OPENAI_SERVICE,
        "unreachable",
        "OpenAI est indisponible pour le moment. Réessayez dans un instant.",
        { status: response.status },
      );
    }
    if (!response.ok) {
      throw new IntegrationError(OPENAI_SERVICE, "OpenAI a refusé la demande.", {
        status: response.status,
      });
    }

    let body: ResponsesApiBody;
    try {
      body = (await response.json()) as ResponsesApiBody;
    } catch (cause) {
      throw new IntegrationError(OPENAI_SERVICE, "Réponse illisible d'OpenAI.", { cause });
    }

    const text = readOutputText(body);
    // `incomplete` : texte coupé par la limite de jetons, inutilisable comme brouillon de réponse.
    const finished = body.status === undefined || body.status === "completed";
    if (!finished || body.error || !text) {
      // Le message du service n'est jamais repris tel quel : il n'est pas destiné à l'utilisateur.
      throw new IntegrationError(OPENAI_SERVICE, "OpenAI n'a pas produit de réponse exploitable.");
    }
    return { text, model: body.model ?? this.config.model };
  }
}

/** Sans configuration : tout appel échoue, aucun succès simulé. */
export const unconfiguredTextGenerator: TextGenerator = {
  isConfigured: false,
  generate: () =>
    Promise.reject(
      new ServiceUnavailableError(OPENAI_SERVICE, "not_configured", OPENAI_NOT_CONFIGURED_MESSAGE),
    ),
};
