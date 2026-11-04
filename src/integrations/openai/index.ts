import "server-only";
import { getEnv } from "@/server/config/env";
import { OpenAiClient, unconfiguredTextGenerator, type TextGenerator } from "./openai.client";

export * from "./openai.client";

let cached: TextGenerator | undefined;

/** Générateur de texte de l'application (`isConfigured` à `false` sans clé ni modèle). */
export function getTextGenerator(): TextGenerator {
  if (cached) return cached;
  const { OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL } = getEnv();
  cached =
    OPENAI_API_KEY && OPENAI_MODEL
      ? new OpenAiClient({
          apiKey: OPENAI_API_KEY,
          model: OPENAI_MODEL,
          baseUrl: OPENAI_BASE_URL,
        })
      : unconfiguredTextGenerator;
  return cached;
}
