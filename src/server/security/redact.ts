/**
 * Masquage des données sensibles avant journalisation ou stockage (journal d'audit).
 *
 * Filet de sécurité : la règle reste de ne JAMAIS passer de secret ou de donnée
 * personnelle superflue aux logs. Ce module protège contre les oublis.
 */

const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authori[sz]ation|cookie|api[-_]?key|credential|private[-_]?key|session|signature|hash/i;

export const REDACTED = "[REDACTED]";

const MAX_DEPTH = 6;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Copie profonde d'une valeur en remplaçant les champs sensibles. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(inner, depth + 1);
  }
  return output;
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  constraint?: string;
  table?: string;
  stack?: string;
  cause?: SerializedError;
}

/**
 * Les erreurs Drizzle (`DrizzleQueryError`) incluent les VALEURS des paramètres SQL
 * dans `message` et donc dans `stack` (adresses e-mail, empreintes de mot de passe…).
 * On ne conserve que la requête paramétrée et la cause.
 */
function isDrizzleQueryError(error: Error): error is Error & { query: string; params: unknown } {
  return "query" in error && "params" in error && typeof error.query === "string";
}

/**
 * Ne garde que les cadres de pile (« at … »). L'en-tête d'une stack reprend le message,
 * qui peut tenir sur plusieurs lignes (cas de Drizzle : « Failed query: …\nparams: … »).
 */
function stackFramesOnly(stack: string | undefined): string | undefined {
  return stack
    ?.split("\n")
    .filter((line) => /^\s+at\s/.test(line))
    .join("\n");
}

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return {
      name: "NonError",
      message: typeof error === "string" ? error : "Valeur non-Error levée",
    };
  }

  const serialized: SerializedError = { name: error.name, message: error.message };

  if (isDrizzleQueryError(error)) {
    serialized.name = "DrizzleQueryError";
    serialized.message = `Échec de requête : ${error.query}`;
    serialized.stack = stackFramesOnly(error.stack);
  } else {
    serialized.stack = error.stack;
  }

  // Erreurs PostgreSQL (driver `pg`) : on garde code / contrainte / table,
  // jamais `detail` qui contient les valeurs en conflit.
  const pgLike = error as Error & { code?: unknown; constraint?: unknown; table?: unknown };
  if (typeof pgLike.code === "string") serialized.code = pgLike.code;
  if (typeof pgLike.constraint === "string") serialized.constraint = pgLike.constraint;
  if (typeof pgLike.table === "string") serialized.table = pgLike.table;

  if (error.cause !== undefined && depth < 3) {
    serialized.cause = serializeError(error.cause, depth + 1);
  }
  return serialized;
}
