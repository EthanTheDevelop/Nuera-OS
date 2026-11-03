import "server-only";
import { redact } from "@/server/security/redact";

/**
 * Logger structuré minimal.
 *
 * - Production : une ligne JSON par événement sur stdout/stderr (collectée par Coolify).
 * - Développement : ligne lisible.
 * - Contexte systématiquement passé par `redact()`.
 *
 * Convention : `event` est un identifiant stable en `domaine.action`
 * (ex. `company.created`, `auth.sign_in_failed`) ; le contexte ne contient
 * ni secret ni donnée personnelle superflue (préférer les identifiants).
 *
 * Exception assumée à la configuration centralisée : le niveau est lu directement
 * dans `process.env.LOG_LEVEL`, car le logger doit fonctionner avant (et pendant)
 * la validation de l'environnement.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

function currentThreshold(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | "silent" | undefined;
  return LEVEL_WEIGHT[configured ?? "info"] ?? LEVEL_WEIGHT.info;
}

const pretty = process.env.NODE_ENV !== "production";

function write(level: LogLevel, event: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < currentThreshold()) return;

  const safeContext = context ? (redact(context) as LogContext) : undefined;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (pretty) {
    const suffix = safeContext ? ` ${JSON.stringify(safeContext)}` : "";
    stream.write(`[${level.toUpperCase()}] ${event}${suffix}\n`);
    return;
  }

  stream.write(
    `${JSON.stringify({ time: new Date().toISOString(), level, event, ...safeContext })}\n`,
  );
}

export const logger = {
  debug: (event: string, context?: LogContext) => write("debug", event, context),
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext) => write("warn", event, context),
  error: (event: string, context?: LogContext) => write("error", event, context),
};
