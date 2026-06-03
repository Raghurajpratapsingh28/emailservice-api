import { z } from 'zod';
import { API_KEY_SCOPES } from '@shared/database/schema/api-keys.js';

export const apiKeyIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const createApiKeyBodySchema = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).default(['events.write']),
  rateLimit: z.number().int().min(0).max(10_000).default(0),
});

export const listApiKeysQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateApiKeyBody = z.infer<typeof createApiKeyBodySchema>;
export type ListApiKeysQuery = z.infer<typeof listApiKeysQuerySchema>;
