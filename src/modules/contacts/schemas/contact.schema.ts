import { z } from 'zod';
import { LIFECYCLE_STAGES } from '@shared/database/schema/contacts.js';

export const contactIdParamSchema = z.object({ id: z.string().uuid() });

export const createContactBodySchema = z.object({
  email: z.string().email().max(254).optional(),
  anonymousId: z.string().max(255).optional(),
  externalId: z.string().max(255).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  leadScore: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  source: z.record(z.string(), z.unknown()).optional(),
}).refine((d) => d.email || d.anonymousId || d.externalId, {
  message: 'At least one of email, anonymousId, or externalId is required',
});

export const updateContactBodySchema = z.object({
  email: z.string().email().max(254).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  leadScore: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  emailSuppressed: z.boolean().optional(),
  globallySuppressed: z.boolean().optional(),
  unsubscribed: z.boolean().optional(),
});

export const listContactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(200).optional(),
  tags: z.string().optional().transform((v) => v ? v.split(',').map((t) => t.trim()).filter(Boolean) : undefined),
  lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
  emailSuppressed: z.coerce.boolean().optional(),
  unsubscribed: z.coerce.boolean().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'leadScore']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const bulkImportBodySchema = z.object({
  contacts: z.array(createContactBodySchema).min(1).max(1000),
});

export type CreateContactBody = z.infer<typeof createContactBodySchema>;
export type UpdateContactBody = z.infer<typeof updateContactBodySchema>;
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;
export type BulkImportBody = z.infer<typeof bulkImportBodySchema>;
