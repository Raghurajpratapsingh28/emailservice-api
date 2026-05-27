import { z } from 'zod';
import { CAMPAIGN_STATUS, CAMPAIGN_TYPES } from '@shared/database/schema/campaigns.js';
import { emailSchema, paginationQuerySchema, uuidSchema } from '@shared/validators/common.js';

const MAX_HTML_BYTES = 1_000_000;
const MAX_TEXT_BYTES = 200_000;

// ─── Building blocks ────────────────────────────────────────────────────────

const senderSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(200).optional(),
});

// ─── Create body ────────────────────────────────────────────────────────────

export const createCampaignBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum([...CAMPAIGN_TYPES] as [string, ...string[]]).optional(),
    subject: z.string().trim().min(1).max(998).optional(),
    previewText: z.string().trim().max(200).optional(),
    from: senderSchema.optional(),
    replyTo: emailSchema.optional(),
    html: z.string().max(MAX_HTML_BYTES).optional(),
    text: z.string().max(MAX_TEXT_BYTES).optional(),
    templateId: uuidSchema.nullable().optional(),
    segmentId: uuidSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // Sender host check — defends against accidental localhost/IP literals.
    if (value.from?.email) {
      const host = value.from.email.split('@')[1] ?? '';
      if (
        host === 'localhost' ||
        host === 'localhost.localdomain' ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sender host cannot be a local or IP literal',
          path: ['from', 'email'],
        });
      }
    }
  });

export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

// ─── Update body ────────────────────────────────────────────────────────────

export const updateCampaignBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    subject: z.string().trim().min(1).max(998).optional(),
    previewText: z.string().trim().max(200).optional(),
    from: senderSchema.optional(),
    replyTo: emailSchema.nullable().optional(),
    html: z.string().max(MAX_HTML_BYTES).nullable().optional(),
    text: z.string().max(MAX_TEXT_BYTES).nullable().optional(),
    templateId: uuidSchema.nullable().optional(),
    segmentId: uuidSchema.nullable().optional(),
    /** Required for optimistic concurrency. */
    version: z.number().int().positive(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.subject !== undefined ||
      v.previewText !== undefined ||
      v.from !== undefined ||
      v.replyTo !== undefined ||
      v.html !== undefined ||
      v.text !== undefined ||
      v.templateId !== undefined ||
      v.segmentId !== undefined,
    { message: 'At least one editable field must be provided' },
  );

export type UpdateCampaignBody = z.infer<typeof updateCampaignBodySchema>;

// ─── Schedule body ──────────────────────────────────────────────────────────

export const scheduleCampaignBodySchema = z.object({
  scheduledAt: z.coerce.date(),
});
export type ScheduleCampaignBody = z.infer<typeof scheduleCampaignBodySchema>;

// ─── List query ─────────────────────────────────────────────────────────────

export const listCampaignsQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...CAMPAIGN_STATUS] as [string, ...string[]]).optional(),
  type: z.enum([...CAMPAIGN_TYPES] as [string, ...string[]]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

// ─── Param ──────────────────────────────────────────────────────────────────

export const campaignIdParamSchema = z.object({
  id: uuidSchema,
});
export type CampaignIdParams = z.infer<typeof campaignIdParamSchema>;
