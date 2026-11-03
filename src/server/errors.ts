/**
 * Erreurs applicatives typées.
 *
 * Règle : la logique métier lève des `AppError` ; les adaptateurs (Server Actions,
 * routes API, pages) les traduisent en réponse. Les messages d'une `AppError`
 * sont destinés à l'utilisateur (français, sans donnée technique ni sensible).
 * Toute autre erreur est considérée comme interne : journalisée, jamais exposée.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTEGRATION"
  | "INTERNAL";

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTEGRATION: 502,
  INTERNAL: 500,
};

export type FieldErrors = Record<string, string[] | undefined>;

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Certaines informations sont invalides.",
    readonly fieldErrors: FieldErrors = {},
  ) {
    super("VALIDATION", message);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Vous devez être connecté.") {
    super("UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Vous n'avez pas les droits nécessaires pour cette action.") {
    super("FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Élément introuvable.") {
    super("NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super("CONFLICT", message);
  }
}

export class IntegrationError extends AppError {
  /** Statut HTTP renvoyé par le service externe, s'il a répondu. */
  readonly status: number | undefined;

  constructor(
    readonly service: string,
    message = `Le service externe « ${service} » est indisponible.`,
    options?: { cause?: unknown; status?: number },
  ) {
    super("INTEGRATION", message, options);
    this.status = options?.status;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
