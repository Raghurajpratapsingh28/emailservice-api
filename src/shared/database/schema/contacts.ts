import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

export const LIFECYCLE_STAGES = [
  'lead',
  'prospect',
  'customer',
  'churned',
  'unqualified',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const contacts = pgTable(
  'contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: varchar({ length: 254 }),
    anonymousId: varchar({ length: 255 }),
    externalId: varchar({ length: 255 }),
    firstName: varchar({ length: 100 }),
    lastName: varchar({ length: 100 }),
    phone: varchar({ length: 30 }),
    lifecycleStage: varchar({ length: 32 }).default('lead'),
    leadScore: integer().notNull().default(0),
    properties: jsonb().notNull().default(sql`'{}'::jsonb`),
    source: jsonb().notNull().default(sql`'{}'::jsonb`),
    emailSuppressed: boolean().notNull().default(false),
    globallySuppressed: boolean().notNull().default(false),
    unsubscribed: boolean().notNull().default(false),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('contacts_workspace_email_uniq').on(t.workspaceId, t.email),
    index('contacts_workspace_idx').on(t.workspaceId),
    index('contacts_email_idx').on(t.email),
    index('contacts_anonymous_id_idx').on(t.anonymousId),
    index('contacts_external_id_idx').on(t.externalId),
    index('contacts_lifecycle_stage_idx').on(t.lifecycleStage),
    index('contacts_created_at_idx').on(t.createdAt),
    index('contacts_properties_gin_idx').using('gin', t.properties),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

export const contactTags = pgTable(
  'contact_tags',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tag: varchar({ length: 100 }).notNull(),
  },
  (t) => [
    uniqueIndex('contact_tags_contact_tag_uniq').on(t.contactId, t.tag),
    index('contact_tags_workspace_idx').on(t.workspaceId),
    index('contact_tags_contact_idx').on(t.contactId),
    index('contact_tags_tag_idx').on(t.tag),
  ],
);

export type ContactTag = typeof contactTags.$inferSelect;
export type NewContactTag = typeof contactTags.$inferInsert;

// Company metadata stored in properties JSONB — no separate table needed for MVP
export type ContactProperties = Record<string, unknown>;
export type ContactSource = {
  channel?: string;
  campaign?: string;
  referrer?: string;
  [key: string]: unknown;
};
