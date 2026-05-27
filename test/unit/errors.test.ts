import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import {
  AppError,
  ConflictError,
  InvalidCredentialsError,
  PermissionDeniedError,
  TokenInvalidError,
  isAppError,
} from '@shared/errors/app-errors.js';

describe('AppError hierarchy', () => {
  it('InvalidCredentialsError → 401 INVALID_CREDENTIALS', () => {
    const err = new InvalidCredentialsError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(isAppError(err)).toBe(true);
  });

  it('ConflictError → 409 with custom code', () => {
    const err = new ConflictError('Email taken', 'EMAIL_TAKEN');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('EMAIL_TAKEN');
  });

  it('TokenInvalidError defaults to 401', () => {
    expect(new TokenInvalidError().statusCode).toBe(401);
  });

  it('PermissionDeniedError carries missing details', () => {
    const err = new PermissionDeniedError(['workspace.write']);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect((err.details as { missing: string[] }).missing).toEqual(['workspace.write']);
  });

  it('subclasses are instanceof AppError', () => {
    expect(new InvalidCredentialsError() instanceof AppError).toBe(true);
  });
});

describe('Zod errors are ZodError', () => {
  it('parses with issues array', () => {
    const schema = z.object({ x: z.number() });
    try {
      schema.parse({ x: 'not-a-number' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ZodError);
      expect((e as ZodError).issues.length).toBeGreaterThan(0);
    }
  });
});
