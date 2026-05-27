import { z } from 'zod';

/** Email — case-insensitive, trimmed, normalized to lowercase. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Invalid email address');

/**
 * Strong password policy:
 *  - 12-128 chars
 *  - at least one uppercase, one lowercase, one digit, one special char
 * (Tune to your security requirements.)
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[a-z]/.test(p), 'Password must contain a lowercase letter')
  .refine((p) => /[A-Z]/.test(p), 'Password must contain an uppercase letter')
  .refine((p) => /\d/.test(p), 'Password must contain a digit')
  .refine((p) => /[^A-Za-z0-9]/.test(p), 'Password must contain a special character');

export const uuidSchema = z.string().uuid('Invalid identifier');

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Invalid slug');

export const opaqueTokenSchema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^[A-Za-z0-9_\-]+$/, 'Invalid token format');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
