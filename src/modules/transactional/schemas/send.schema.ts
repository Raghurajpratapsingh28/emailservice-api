import { z } from 'zod';
import { emailSchema, paginationQuerySchema, uuidSchema } from '@shared/validators/common.js';
import { EMAIL_SEND_STATUS } from '@shared/database/schema/emails.js';

const MAX_RECIPIENTS = 50;
const MAX_HTML_BYTES = 1_000_000; // 1 MB
const MAX_TEXT_BYTES = 200_000; // 200 KB
const MAX_TAG_COUNT = 50;

// ─── Building blocks ────────────────────────────────────────────────────────

const recipientSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(200).optional(),
});

const senderSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(200).optional(),
});

/**
 * Tag map for the provider — flat string→string. Constrained to keep payload
 * size bounded.
 */
const tagsSchema = z
  .record(z.string().min(1).max(64), z.string().min(0).max(256))
  .refine((v) => Object.keys(v).length <= MAX_TAG_COUNT, {
    message: `tags may have at most ${MAX_TAG_COUNT} keys`,
  });

const templateDataSchema = z.record(z.string(), z.unknown());

// ─── Send body ──────────────────────────────────────────────────────────────

export const sendEmailBodySchema = z
  .object({
    to: z.array(recipientSchema).min(1).max(MAX_RECIPIENTS),
    from: senderSchema,
    replyTo: emailSchema.optional(),
    subject: z.string().trim().min(1).max(998).optional(),
    html: z
      .string()
      .max(MAX_HTML_BYTES, `html exceeds ${MAX_HTML_BYTES} bytes`)
      .optional(),
    text: z
      .string()
      .max(MAX_TEXT_BYTES, `text exceeds ${MAX_TEXT_BYTES} bytes`)
      .optional(),
    templateId: uuidSchema.nullable().optional(),
    templateData: templateDataSchema.optional(),
    tags: tagsSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  /**
   * Cross-field invariants:
   *  - Either a templateId OR (subject + at least one of html/text) is required.
   *  - If templateId is set, subject becomes optional (template carries it).
   *  - The sender email's host cannot be a localhost / loopback literal —
   *    full sending-domain verification is enforced by the service.
   */
  .superRefine((value, ctx) => {
    const hasTemplate = value.templateId !== null && value.templateId !== undefined;
    if (!hasTemplate) {
      if (!value.subject) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'subject is required when templateId is not provided',
          path: ['subject'],
        });
      }
      if (!value.html && !value.text) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'either html or text is required when templateId is not provided',
          path: ['html'],
        });
      }
    }

    // Local sender host check — defends against accidental @localhost senders.
    const fromHost = value.from.email.split('@')[1] ?? '';
    if (
      fromHost === 'localhost' ||
      fromHost === 'localhost.localdomain' ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(fromHost) // IPv4 literal
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sender host cannot be a local or IP literal',
        path: ['from', 'email'],
      });
    }
  });

export type SendEmailBody = z.infer<typeof sendEmailBodySchema>;

// ─── Send list query ────────────────────────────────────────────────────────

export const listSendsQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...EMAIL_SEND_STATUS] as [string, ...string[]]).optional(),
  recipient: z.string().trim().min(1).max(254).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});
export type ListSendsQuery = z.infer<typeof listSendsQuerySchema>;

export const sendIdParamSchema = z.object({
  sendId: uuidSchema,
});
export type SendIdParams = z.infer<typeof sendIdParamSchema>;
