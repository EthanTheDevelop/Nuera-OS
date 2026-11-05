import "server-only";
import { z } from "@/lib/zod";

/** Variable facultative : une valeur vide dans `.env` vaut « absente ». */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

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

  // CRM Twenty : facultatif, l'intégration signale « connexion requise » si absent.
  TWENTY_API_URL: optional(z.url({ protocol: /^https?$/ })),
  TWENTY_API_KEY: optional(z.string()),
  TWENTY_WEBHOOK_SECRET: optional(z.string().min(32)),

  // Lien « Base de données » du groupe Outils, pour les associés. Absent : pas de lien.
  DB_ADMIN_URL: optional(z.url({ protocol: /^https?$/ })),

  // Coolify et Uptime Kuma : facultatifs, les sites affichent « connexion requise » si absents.
  COOLIFY_API_URL: optional(z.url({ protocol: /^https?$/ })),
  COOLIFY_API_TOKEN: optional(z.string()),
  COOLIFY_WEBHOOK_SECRET: optional(z.string().min(32)),
  UPTIME_KUMA_URL: optional(z.url({ protocol: /^https?$/ })),
  UPTIME_KUMA_STATUS_SLUG: optional(z.string()),
  UPTIME_KUMA_WEBHOOK_SECRET: optional(z.string().min(32)),

  // Signature DocuSeal : facultatif, l'écran Devis signale « connexion requise » si absent.
  DOCUSEAL_API_URL: optional(z.url({ protocol: /^https?$/ })),
  DOCUSEAL_API_KEY: optional(z.string()),
  DOCUSEAL_WEBHOOK_SECRET: optional(z.string().min(16)),

  // Stockage des documents : facultatif, « connexion requise » si absent.
  STORAGE_DIR: optional(z.string()),
  STORAGE_MAX_UPLOAD_MB: optional(z.coerce.number().int().min(1).max(2048)),

  // Réponses suggérées (OpenAI) : facultatif, le panneau signale « connexion requise » si absent.
  OPENAI_API_KEY: optional(z.string()),
  OPENAI_MODEL: optional(z.string()),
  OPENAI_BASE_URL: optional(z.url({ protocol: /^https?$/ })),
  // Webhook Cal.diy / Cal.com : la route ne répond que si ce secret est défini.
  CAL_WEBHOOK_SECRET: optional(z.string().min(16)),

  // Tâches planifiées : sans ce secret, /api/jobs/* répond 404.
  JOBS_SECRET: optional(z.string().min(32)),

  // E-mails sortants : sans hôte ni expéditeur, la boîte d'envoi reste « non configurée ».
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535)),
  SMTP_SECURE: optional(z.stringbool()),
  SMTP_USER: optional(z.string()),
  SMTP_PASSWORD: optional(z.string()),
  SMTP_FROM: optional(z.string()),

  // n8n : facultatif. Sans URL ni secret, la règle de relais échoue en « connexion requise ».
  N8N_WEBHOOK_URL: optional(z.url({ protocol: /^https?$/ })),
  N8N_WEBHOOK_SECRET: optional(z.string().min(32)),
  N8N_WEBHOOK_HEADER_TOKEN: optional(z.string().min(16)),
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
