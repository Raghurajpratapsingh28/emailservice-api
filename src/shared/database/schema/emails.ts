import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Transactional email infrastructure: per-workspace templates and per-send records.
 *
 * Two tables:
 *   - email_templates  — versioned, draft → published lifecycle, immutable history
 *   - email_sends      — one row per transactional API call, append-only state machine
 */

// ─── Send statuses ──────────────────────────────────────────────────────────

export const EMAIL_SEND_STATUS = [
  'queued',
  'sending',
  'sent',
  'failed',
  'bounced',
  'complained',
] as const;
export type EmailSendStatus = (typeof EMAIL_SEND_STATUS)[number];

export const EMAIL_PROVIDERS = ['ses'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

// ─── Template statuses ──────────────────────────────────────────────────────

export const EMAIL_TEMPLATE_STATUS = ['draft', 'published', 'archived'] as const;
export type EmailTemplateStatus = (typeof EMAIL_TEMPLATE_STATUS)[number];

// ─── email_templates ────────────────────────────────────────────────────────

/**
 * Versioned email templates.
 *
 *   - Each (workspace_id, name, version) tuple is unique.
 *   - `version` starts at 1 on create and increments on `publish` of an
 *     existing template name.
 *   - `status='draft'` rows are mutable; `status='published'` rows are
 *     immutable history (clients reference them at send time).
 *   - `variables` is the declared schema of placeholders the template accepts
 *     (e.g. `{ "first_name": "string" }`); the service merges `templateData`
 *     against this at send time.
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar({ length: 200 }).notNull(),
    version: integer().notNull().default(1),
    subject: varchar({ length: 998 }).notNull(),
    htmlBody: text(),
    textBody: text(),
    /** Declared template variables. Shape is free-form jsonb. */
    variables: jsonb().notNull().default(sql`'{}'::jsonb`),
    status: varchar({ length: 16 }).notNull().default('draft'),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    /** A workspace cannot have two templates with the same (name, version). */
    uniqueIndex('email_templates_workspace_name_version_uniq').on(
      t.workspaceId,
      t.name,
      t.version,
    ),
    index('email_templates_workspace_idx').on(t.workspaceId),
    index('email_templates_workspace_name_idx').on(t.workspaceId, t.name),
    index('email_templates_status_idx').on(t.status),
  ],
);

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;

// ─── email_sends ────────────────────────────────────────────────────────────

/**
 * Per-send record for transactional emails.
 *
 *   - `sendId` is a workspace-friendly external id (uuid), distinct from the
 *     internal `id` so external systems can reference it without joining.
 *   - `recipient_email` is the *primary* recipient (first in `to[]`). The
 *     full recipient set is preserved in `metadata.to[]` so we don't lose
 *     it for audit, while keeping `recipient_email` indexable.
 *   - `tags` go to the email provider; `metadata` is internal-only.
 */
export const emailSends = pgTable(
  'email_sends',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Public-facing send id (returned to API clients). */
    sendId: uuid().notNull().defaultRandom(),
    status: varchar({ length: 16 }).notNull().default('queued'),
    senderEmail: varchar({ length: 254 }).notNull(),
    senderName: varchar({ length: 200 }),
    replyTo: varchar({ length: 254 }),
    recipientEmail: varchar({ length: 254 }).notNull(),
    recipientName: varchar({ length: 200 }),
    subject: varchar({ length: 998 }).notNull(),
    htmlBody: text(),
    textBody: text(),
    templateId: uuid().references(() => emailTemplates.id, { onDelete: 'set null' }),
    templateVersion: integer(),
    templateData: jsonb().notNull().default(sql`'{}'::jsonb`),
    provider: varchar({ length: 32 }).notNull().default('ses'),
    providerMessageId: varchar({ length: 255 }),
    failureReason: text(),
    /** Provider tags — flat string→string map. */
    tags: jsonb().notNull().default(sql`'{}'::jsonb`),
    /** Internal metadata: full recipients[], idempotencyKey, requestId, etc. */
    metadata: jsonb().notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('email_sends_send_id_uniq').on(t.sendId),
    index('email_sends_workspace_idx').on(t.workspaceId),
    index('email_sends_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('email_sends_status_idx').on(t.status),
    index('email_sends_recipient_idx').on(t.recipientEmail),
    index('email_sends_provider_msg_idx').on(t.providerMessageId),
  ],
);

export type EmailSend = typeof emailSends.$inferSelect;
export type NewEmailSend = typeof emailSends.$inferInsert;
