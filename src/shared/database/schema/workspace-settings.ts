import { sql } from 'drizzle-orm';
import {
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

/**
 * Per-workspace settings. One-to-one with workspaces (workspaceId is unique).
 *
 * All structured config (branding, feature flags, etc.) lives in jsonb columns
 * so we can evolve without migrations. Use Zod at the API layer to enforce shape.
 */
export const workspaceSettings = pgTable(
  'workspace_settings',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    timezone: varchar({ length: 64 }).notNull().default('UTC'),
    locale: varchar({ length: 16 }).notNull().default('en-US'),
    branding: jsonb().notNull().default(sql`'{}'::jsonb`),
    emailDefaults: jsonb().notNull().default(sql`'{}'::jsonb`),
    featureFlags: jsonb().notNull().default(sql`'{}'::jsonb`),
    webhookSettings: jsonb().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [uniqueIndex('workspace_settings_workspace_uniq').on(t.workspaceId)],
);

export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
export type NewWorkspaceSettings = typeof workspaceSettings.$inferInsert;

export interface BrandingSettings {
  logoUrl?: string;
  primaryColor?: string;
  faviconUrl?: string;
}

export interface EmailDefaults {
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  footerHtml?: string;
}

export interface WebhookSettings {
  url?: string;
  secret?: string;
  events?: string[];
}
