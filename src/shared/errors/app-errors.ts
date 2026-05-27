/**
 * Centralized application error hierarchy. The Fastify error-handler hook
 * inspects `AppError` instances to produce sanitized HTTP responses without
 * leaking internals.
 *
 * Conventions:
 *   - `code`: stable, machine-readable identifier (UPPER_SNAKE_CASE). Safe to expose.
 *   - `message`: human-readable, safe to expose.
 *   - `statusCode`: HTTP status to map to.
 *   - `details`: optional additional safe context (e.g. validation issues).
 *   - `cause`: original error chain, never serialized to clients.
 */

export interface AppErrorOptions {
  code?: string;
  statusCode?: number;
  details?: Record<string, unknown> | unknown;
  cause?: unknown;
  expose?: boolean;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown> | unknown;
  /** When false, the message is replaced with a generic one in responses. */
  public readonly expose: boolean;

  public constructor(message: string, opts: AppErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code ?? 'INTERNAL_ERROR';
    this.statusCode = opts.statusCode ?? 500;
    this.details = opts.details;
    this.expose = opts.expose ?? true;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  public constructor(message = 'Validation failed', details?: unknown) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, details });
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(message, { code, statusCode: 401 });
  }
}

export class ForbiddenError extends AppError {
  public constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, { code, statusCode: 403 });
  }
}

export class NotFoundError extends AppError {
  public constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message, { code, statusCode: 404 });
  }
}

export class ConflictError extends AppError {
  public constructor(message = 'Conflict', code = 'CONFLICT') {
    super(message, { code, statusCode: 409 });
  }
}

export class TooManyRequestsError extends AppError {
  public constructor(message = 'Too many requests', code = 'RATE_LIMITED') {
    super(message, { code, statusCode: 429 });
  }
}

export class InternalServerError extends AppError {
  public constructor(message = 'Internal server error', cause?: unknown) {
    super(message, { code: 'INTERNAL_ERROR', statusCode: 500, expose: false, cause });
  }
}

// ─── Domain-specific auth errors ─────────────────────────────────────────────

export class InvalidCredentialsError extends UnauthorizedError {
  public constructor() {
    super('Invalid email or password', 'INVALID_CREDENTIALS');
  }
}

export class AccountLockedError extends UnauthorizedError {
  public constructor(retryAfterSeconds: number) {
    super('Account temporarily locked due to too many failed attempts', 'ACCOUNT_LOCKED');
    (this as unknown as { details: unknown }).details = { retryAfterSeconds };
  }
}

export class AccountDisabledError extends UnauthorizedError {
  public constructor() {
    super('Account is disabled', 'ACCOUNT_DISABLED');
  }
}

export class EmailNotVerifiedError extends ForbiddenError {
  public constructor() {
    super('Email not verified', 'EMAIL_NOT_VERIFIED');
  }
}

export class TokenInvalidError extends UnauthorizedError {
  public constructor(message = 'Invalid or expired token') {
    super(message, 'TOKEN_INVALID');
  }
}

export class TokenReuseError extends UnauthorizedError {
  public constructor() {
    super('Refresh token reuse detected; sessions revoked', 'TOKEN_REUSE');
  }
}

export class WorkspaceAccessDeniedError extends ForbiddenError {
  public constructor() {
    super('You do not have access to this workspace', 'WORKSPACE_ACCESS_DENIED');
  }
}

export class PermissionDeniedError extends ForbiddenError {
  public constructor(missing: readonly string[]) {
    super('Missing required permissions', 'PERMISSION_DENIED');
    (this as unknown as { details: unknown }).details = { missing };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
