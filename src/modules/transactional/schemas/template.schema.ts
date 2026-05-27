import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from '@shared/validators/common.js';
import { EMAIL_TEMPLATE_STATUS } from '@shared/database/schema/emails.js';

const TEMPLATE_NAME_RE = /^[a-zA-Z0-9_.\- ]+$/;
const MAX_HTML_BYTES = 1_000_000;
const MAX_TEXT_BYTES = 200_000;

const variablesSchema = z.record(z.string(), z.unknown());

// ─── Create body ────────────────────────────────────────────────────────────

export const createTemplateBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(TEMPLATE_NAME_RE, 'name may contain letters, digits, _, ., -, space'),
    subject: z.string().trim().min(1).max(998),
    htmlBody: z.string().max(MAX_HTML_BYTES).optional(),
    textBody: z.string().max(MAX_TEXT_BYTES).optional(),
    variables: variablesSchema.optional(),
    /** If true, immediately publish the new draft. Default false. */
    publish: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.htmlBody) || Boolean(v.textBody), {
    message: 'At least one of htmlBody or textBody is required',
    path: ['htmlBody'],
  });

export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

// ─── Update body ────────────────────────────────────────────────────────────

export const updateTemplateBodySchema = z
  .object({
    subject: z.string().trim().min(1).max(998).optional(),
    htmlBody: z.string().max(MAX_HTML_BYTES).optional(),
    textBody: z.string().max(MAX_TEXT_BYTES).optional(),
    variables: variablesSchema.optional(),
    /** When true, transitions the draft to published. */
    publish: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.subject !== undefined ||
      v.htmlBody !== undefined ||
      v.textBody !== undefined ||
      v.variables !== undefined ||
      v.publish !== undefined,
    { message: 'At least one field must be provided' },
  );

export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>;

// ─── List query ─────────────────────────────────────────────────────────────

export const listTemplatesQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...EMAIL_TEMPLATE_STATUS] as [string, ...string[]]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  /** When true, only the latest version per template name. */
  latestOnly: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

export const templateIdParamSchema = z.object({
  id: uuidSchema,
});
export type TemplateIdParams = z.infer<typeof templateIdParamSchema>;
