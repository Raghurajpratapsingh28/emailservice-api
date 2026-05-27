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
import { emailTemplates } from './emails.js';
import { segments } from './segments.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Campaign types and status state machine.
 *
 *   draft ──schedule──► scheduled ──cron/trigger──► sending ──┬──► sent
 *     │                    │                          │       └──► failed
 *     │                    └─pause─► paused ─resume───┘
 *     │                    │
 *     │                    └─resume─► scheduled (re-schedule)
 *     ▼
 *   sending ──pause──► paused ──resume──► sending
 *     │
 *     ▼
 *   sent | failed | cancelled
 *
 * Allowed transitions are enforced by the service layer; the DB stores the
 * status as a stable string so analytics queries are simple.
 */
export const CAMPAIGN_STATUS = [
  'draft',
  'scheduled',
  'sending',
  'paused',
  'sent',
  'failed',
  'cancelled',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUS)[number];

export const CAMPAIGN_TYPES = ['regular', 'ab_test', 'rss', 'transactional'] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar({ length: 200 }).notNull(),
    type: varchar({ length: 32 }).notNull().default('regular'),
    status: varchar({ length: 16 }).notNull().default('draft'),
    subject: varchar({ length: 998 }),
    previewText: varchar({ length: 200 }),
    senderEmail: varchar({ length: 254 }),
    senderName: varchar({ length: 200 }),
    replyTo: varchar({ length: 254 }),
    htmlBody: text(),
    textBody: text(),
    templateId: uuid().references(() => emailTemplates.id, { onDelete: 'set null' }),
    segmentId: uuid().references(() => segments.id, { onDelete: 'set null' }),
    /** Snapshotted recipient count at send time. */
    recipientCount: integer().notNull().default(0),
    sentCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    /** Where to record the send-time payload for audit / re-replay. */
    sendMetadata: jsonb().notNull().default(sql`'{}'::jsonb`),
    /** Optimistic concurrency token. */
    version: integer().notNull().default(1),
    scheduledAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    pausedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    /** Unique campaign name per workspace among non-deleted rows is enforced at the service layer */
    uniqueIndex('campaigns_workspace_name_uniq').on(t.workspaceId, t.name),
    index('campaigns_workspace_idx').on(t.workspaceId),
    index('campaigns_status_idx').on(t.status),
    index('campaigns_segment_idx').on(t.segmentId),
    index('campaigns_scheduled_at_idx').on(t.scheduledAt),
    index('campaigns_workspace_created_idx').on(t.workspaceId, t.createdAt),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

/**
 * Per-recipient send record. Materialised when a campaign starts sending; the
 * worker updates `status` + delivery timestamps as provider events flow back.
 */
export const CAMPAIGN_RECIPIENT_STATUS = [
  'pending',
  'sending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'failed',
  'unsubscribed',
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUS)[number];

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** Optional FK to contacts.id once that module exists; nullable until then. */
    contactId: uuid(),
    email: varchar({ length: 254 }).notNull(),
    status: varchar({ length: 16 }).notNull().default('pending'),
    providerMessageId: varchar({ length: 255 }),
    failureReason: text(),
    sentAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    openedAt: timestamp({ withTimezone: true }),
    clickedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** A campaign cannot deliver to the same email twice. */
    uniqueIndex('campaign_recipients_campaign_email_uniq').on(t.campaignId, t.email),
    index('campaign_recipients_campaign_idx').on(t.campaignId),
    index('campaign_recipients_workspace_idx').on(t.workspaceId),
    index('campaign_recipients_status_idx').on(t.status),
    index('campaign_recipients_email_idx').on(t.email),
    index('campaign_recipients_provider_msg_idx').on(t.providerMessageId),
  ],
);

export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;
