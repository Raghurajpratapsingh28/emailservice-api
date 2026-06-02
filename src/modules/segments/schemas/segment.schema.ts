import { z } from 'zod';
import { SEGMENT_TYPES } from '@shared/database/schema/segments.js';

export const segmentIdParamSchema = z.object({ id: z.string().uuid() });

const filterOperators = [
  'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
  'greater_than', 'less_than', 'exists', 'not_exists', 'in', 'not_in',
  'occurred_within_days',
] as const;

const filterRuleSchema: z.ZodType<{
  field: string;
  operator: (typeof filterOperators)[number];
  value?: unknown;
}> = z.object({
  field: z.string().min(1).max(200),
  operator: z.enum(filterOperators),
  value: z.unknown().optional(),
});

// Recursive filter tree — lazy to allow self-reference
const filterTreeSchema: z.ZodType<{
  operator: 'AND' | 'OR';
  rules: Array<{ field: string; operator: (typeof filterOperators)[number]; value?: unknown } | { operator: 'AND' | 'OR'; rules: unknown[] }>;
}> = z.lazy(() =>
  z.object({
    operator: z.enum(['AND', 'OR']),
    rules: z.array(z.union([filterRuleSchema, filterTreeSchema])).min(1).max(50),
  }),
);

export const createSegmentBodySchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(SEGMENT_TYPES).default('static'),
  filterTree: filterTreeSchema.optional(),
});

export const updateSegmentBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(SEGMENT_TYPES).optional(),
  filterTree: filterTreeSchema.optional(),
});

export const listSegmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const previewSegmentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const segmentContactParamSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
});

export const addContactToSegmentBodySchema = z.object({
  contactId: z.string().uuid(),
});

export type CreateSegmentBody = z.infer<typeof createSegmentBodySchema>;
export type UpdateSegmentBody = z.infer<typeof updateSegmentBodySchema>;
export type ListSegmentsQuery = z.infer<typeof listSegmentsQuerySchema>;
export type AddContactToSegmentBody = z.infer<typeof addContactToSegmentBodySchema>;
