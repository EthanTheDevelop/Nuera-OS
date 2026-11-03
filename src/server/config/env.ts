import "server-only";
import { z } from "@/lib/zod";

/**
 * Configuration serveur, validée une seule fois et figée.
 *
 * Lecture paresseuse (`getEnv()`) : le build Next.js et l'image Docker n'ont
 * besoin d'aucun secret ; la validation a lieu au démarrage du serveur
 * (`src/instrumentation.ts`) et échoue immédiatement si la configuration est invalide.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL doit être une URL postgres:// ou postgresql://"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_MIGRATE_ON_START: z.stringbool().default(false),

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET doit contenir au moins 32 caractères (voir .env.example)"),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Env = Readonly<z.infer<typeof envSchema>>;

let cached: Env | undefined;

export class InvalidEnvironmentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuration invalide :\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "InvalidEnvironmentError";
  }
}

/** Valide un objet d'environnement. Les messages ne contiennent jamais les valeurs. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(racine)"} : ${issue.message}`,
      ),
    );
  }
  return Object.freeze(result.data);
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
