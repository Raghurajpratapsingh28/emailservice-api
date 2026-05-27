import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  uuidSchema,
} from '@shared/validators/common.js';
import {
  loginBodySchema,
  signupBodySchema,
} from '@modules/auth/schemas/auth.schema.js';

describe('validators', () => {
  it('emailSchema lowercases and trims', () => {
    const out = emailSchema.parse('  USER@Example.COM  ');
    expect(out).toBe('user@example.com');
  });

  it('emailSchema rejects invalid emails', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow(z.ZodError);
  });

  it('passwordSchema requires complexity', () => {
    expect(() => passwordSchema.parse('short')).toThrow();
    expect(() => passwordSchema.parse('alllowercaseonly1!')).toThrow();
    expect(() => passwordSchema.parse('NOLOWER12345!')).toThrow();
    expect(() => passwordSchema.parse('NoSpecial1234')).toThrow();
    expect(() => passwordSchema.parse('NoDigits!!!!Aa')).toThrow();
    expect(passwordSchema.parse('GoodPass!2345A')).toBe('GoodPass!2345A');
  });

  it('uuidSchema accepts UUIDv4', () => {
    expect(uuidSchema.parse('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
  });
});

describe('auth schemas', () => {
  it('signupBodySchema accepts valid input', () => {
    const out = signupBodySchema.parse({
      email: 'NEW@x.com',
      password: 'GoodPass!2345A',
      firstName: '  Alice  ',
      lastName: 'Smith',
      workspaceName: 'Acme',
    });
    expect(out.email).toBe('new@x.com');
    expect(out.firstName).toBe('Alice');
    expect(out.workspaceName).toBe('Acme');
  });

  it('loginBodySchema requires email + password', () => {
    expect(() => loginBodySchema.parse({ email: 'x@y.com' })).toThrow();
    expect(loginBodySchema.parse({ email: 'x@y.com', password: 'anything' })).toEqual({
      email: 'x@y.com',
      password: 'anything',
    });
  });
});
