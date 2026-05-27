import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { JwtErrors } from '@shared/utils/jwt.js';
import { AppError, isAppError } from '@shared/errors/app-errors.js';
import type { ErrorResponseBody } from '@shared/types/index.js';

/**
 * Centralized error handler. Translates known errors into stable HTTP responses
 * and hides internals on 5xx.
 */
export function errorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation
  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
        requestId: req.id,
      },
    };
    void reply.status(400).send(body);
    return;
  }

  // Fastify schema validation (ajv)
  if ('validation' in err && Array.isArray((err as FastifyError).validation)) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (err as FastifyError).validation,
        requestId: req.id,
      },
    };
    void reply.status(400).send(body);
    return;
  }

  // JWT errors from @fastify/jwt or our jsonwebtoken wrapper
  if (
    err instanceof JwtErrors.TokenExpiredError ||
    err instanceof JwtErrors.JsonWebTokenError ||
    err instanceof JwtErrors.NotBeforeError
  ) {
    const body: ErrorResponseBody = {
      error: {
        code: 'TOKEN_INVALID',
        message: 'Invalid or expired token',
        requestId: req.id,
      },
    };
    void reply.status(401).send(body);
    return;
  }

  // App errors
  if (isAppError(err)) {
    const body: ErrorResponseBody = {
      error: {
        code: err.code,
        message: err.expose ? err.message : 'Internal server error',
        details: err.expose ? (err.details as unknown) : undefined,
        requestId: req.id,
      },
    };
    void reply.status(err.statusCode).send(body);
    return;
  }

  // Rate-limit (from @fastify/rate-limit it's a 429 with statusCode set)
  const fastifyErr = err as FastifyError;
  if (typeof fastifyErr.statusCode === 'number' && fastifyErr.statusCode === 429) {
    const body: ErrorResponseBody = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        requestId: req.id,
      },
    };
    void reply.status(429).send(body);
    return;
  }

  // Generic 4xx coming from Fastify (e.g. body parsing)
  if (
    typeof fastifyErr.statusCode === 'number' &&
    fastifyErr.statusCode >= 400 &&
    fastifyErr.statusCode < 500
  ) {
    const body: ErrorResponseBody = {
      error: {
        code: fastifyErr.code ?? 'BAD_REQUEST',
        message: err.message || 'Bad request',
        requestId: req.id,
      },
    };
    void reply.status(fastifyErr.statusCode).send(body);
    return;
  }

  // Unknown: log + 500
  req.log.error({ err }, 'Unhandled error');
  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: req.id,
    },
  };
  void reply.status(500).send(body);
}

/** Convenience type re-export. */
export { AppError };
