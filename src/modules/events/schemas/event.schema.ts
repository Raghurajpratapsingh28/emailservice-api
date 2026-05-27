import { z } from 'zod';

/**
 * 32 KB payload guard — applied to the entire request body.
 * We check byte length of the JSON string, not the parsed object.
 */
export const MAX_PAYLOAD_BYTES = 32 * 1024;

// ─── Shared building blocks ──────────────────────────────────────────────────

const jsonObjectSchema = z.record(z.string(), z.unknown());

const timestampSchema = z.coerce.date().optional();

const contextSchema = jsonObjectSchema.optional();

const baseEventSchema = z.object({
  userId: z.string().trim().min(1).max(512).optional(),
  anonymousId: z.string().trim().min(1).max(512).optional(),
  timestamp: timestampSchema,
  context: contextSchema,
  messageId: z.string().trim().min(1).max(128).optional(),
});

/** At least one of userId or anonymousId must be present. */
function requireIdentity<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.superRefine((v, ctx) => {
    if (!v.userId && !v.anonymousId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either userId or anonymousId is required',
        path: ['userId'],
      });
    }
  });
}

// ─── Track ───────────────────────────────────────────────────────────────────

export const trackBodySchema = requireIdentity(
  baseEventSchema.extend({
    event: z.string().trim().min(1).max(512),
    properties: jsonObjectSchema.optional(),
  }),
);
export type TrackBody = z.infer<typeof trackBodySchema>;

// ─── Identify ────────────────────────────────────────────────────────────────

export const identifyBodySchema = requireIdentity(
  baseEventSchema.extend({
    traits: jsonObjectSchema.optional(),
  }),
);
export type IdentifyBody = z.infer<typeof identifyBodySchema>;

// ─── Page ────────────────────────────────────────────────────────────────────

export const pageBodySchema = requireIdentity(
  baseEventSchema.extend({
    name: z.string().trim().min(1).max(512).optional(),
    properties: jsonObjectSchema.optional(),
  }),
);
export type PageBody = z.infer<typeof pageBodySchema>;

// ─── Group ───────────────────────────────────────────────────────────────────

export const groupBodySchema = baseEventSchema
  .extend({
    userId: z.string().trim().min(1).max(512).optional(),
    anonymousId: z.string().trim().min(1).max(512).optional(),
    groupId: z.string().trim().min(1).max(512),
    traits: jsonObjectSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.userId && !v.anonymousId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either userId or anonymousId is required',
        path: ['userId'],
      });
    }
  });
export type GroupBody = z.infer<typeof groupBodySchema>;

// ─── Alias ───────────────────────────────────────────────────────────────────

export const aliasBodySchema = z.object({
  previousId: z.string().trim().min(1).max(512),
  userId: z.string().trim().min(1).max(512),
  timestamp: timestampSchema,
  context: contextSchema,
  messageId: z.string().trim().min(1).max(128).optional(),
});
export type AliasBody = z.infer<typeof aliasBodySchema>;

// ─── Debug query ─────────────────────────────────────────────────────────────

export const debugQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});
