/**
 * Lecture des erreurs PostgreSQL, qu'elles viennent du driver directement
 * ou enveloppées par Drizzle (`DrizzleQueryError.cause`).
 */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
/** `ON DELETE RESTRICT` : 23503 jusqu'à PostgreSQL 17, 23001 à partir de PostgreSQL 18. */
const RESTRICT_VIOLATION = "23001";

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

function findPgError(error: unknown, depth = 0): PgErrorLike | undefined {
  if (!error || typeof error !== "object" || depth > 3) return undefined;
  const candidate = error as PgErrorLike & { cause?: unknown };
  if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) return candidate;
  return findPgError(candidate.cause, depth + 1);
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  return pg?.code === UNIQUE_VIOLATION && (!constraint || pg.constraint === constraint);
}

export function isForeignKeyViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  return (
    (pg?.code === FOREIGN_KEY_VIOLATION || pg?.code === RESTRICT_VIOLATION) &&
    (!constraint || pg.constraint === constraint)
  );
}
