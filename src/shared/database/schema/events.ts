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
import { apiKeys } from './api-keys.js';
import { workspaces } from './workspaces.js';

/**
 * Event ingestion tables.
 *
 * MVP: PostgreSQL storage. Schema is designed to be migration-friendly to
 * ClickHouse later:
 *   - `events_raw` has no FK constraints on userId/anonymousId (they're
 *     strings, not FK references) so the table can be replicated as-is.
 *   - `received_at` and `normalized_timestamp` are separate so ClickHouse
 *     can use `normalized_timestamp` as the ORDER BY key.
 *   - `status` column allows a worker to mark rows as processed without
 *     deleting them (append-only semantics).
 *   - `jsonb` columns (traits, properties, context) map to ClickHouse
 *     `String` (JSON) or `Map` columns.
 */

// ─── Event types ─────────────────────────────────────────────────────────────

export const EVENT_TYPES = ['track', 'identify', 'page', 'group', 'alias'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_RAW_STATUS = ['pending', 'processed', 'failed', 'schema_violation'] as const;
export type EventRawStatus = (typeof EVENT_RAW_STATUS)[number];

// ─── events_raw ──────────────────────────────────────────────────────────────

export const eventsRaw = pgTable(
  'events_raw',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    apiKeyId: uuid()
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'restrict' }),
    eventType: varchar({ length: 16 }).notNull(),
    /** Normalised event name (e.g. "Page Viewed" for page calls). */
    eventName: varchar({ length: 512 }),
    userId: varchar({ length: 512 }),
    anonymousId: varchar({ length: 512 }),
    groupId: varchar({ length: 512 }),
    traits: jsonb().notNull().default(sql`'{}'::jsonb`),
    properties: jsonb().notNull().default(sql`'{}'::jsonb`),
    context: jsonb().notNull().default(sql`'{}'::jsonb`),
    /** Server-side ingestion timestamp. */
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Client-supplied timestamp (may be null if not provided). */
    originalTimestamp: timestamp({ withTimezone: true }),
    /** Canonical timestamp used for ordering: originalTimestamp ?? receivedAt. */
    normalizedTimestamp: timestamp({ withTimezone: true }).notNull().defaultNow(),
    status: varchar({ length: 24 }).notNull().default('pending'),
    processingAttempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_raw_workspace_idx').on(t.workspaceId),
    index('events_raw_workspace_received_idx').on(t.workspaceId, t.receivedAt),
    index('events_raw_event_name_idx').on(t.eventName),
    index('events_raw_user_id_idx').on(t.userId),
    index('events_raw_anon_id_idx').on(t.anonymousId),
    index('events_raw_status_idx').on(t.status),
    index('events_raw_api_key_idx').on(t.apiKeyId),
  ],
);

export type EventRaw = typeof eventsRaw.$inferSelect;
export type NewEventRaw = typeof eventsRaw.$inferInsert;

// ─── event_schemas ───────────────────────────────────────────────────────────

export const EVENT_VALIDATION_MODES = ['soft', 'hard'] as const;
export type EventValidationMode = (typeof EVENT_VALIDATION_MODES)[number];

export const eventSchemas = pgTable(
  'event_schemas',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    eventName: varchar({ length: 512 }).notNull(),
    /** JSON Schema (draft-07) definition for the event's `properties`. */
    schemaDefinition: jsonb().notNull().default(sql`'{}'::jsonb`),
    validationMode: varchar({ length: 8 }).notNull().default('soft'),
    isActive: boolean().notNull().default(true),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('event_schemas_workspace_name_uniq').on(t.workspaceId, t.eventName),
    index('event_schemas_workspace_idx').on(t.workspaceId),
    index('event_schemas_active_idx').on(t.workspaceId, t.isActive),
  ],
);

export type EventSchema = typeof eventSchemas.$inferSelect;
export type NewEventSchema = typeof eventSchemas.$inferInsert;

// ─── event_debug_logs ────────────────────────────────────────────────────────

export const eventDebugLogs = pgTable(
  'event_debug_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    eventId: uuid()
      .notNull()
      .references(() => eventsRaw.id, { onDelete: 'cascade' }),
    validationErrors: jsonb().notNull().default(sql`'[]'::jsonb`),
    processingNotes: jsonb().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('event_debug_logs_workspace_idx').on(t.workspaceId),
    index('event_debug_logs_event_idx').on(t.eventId),
  ],
);

export type EventDebugLog = typeof eventDebugLogs.$inferSelect;
export type NewEventDebugLog = typeof eventDebugLogs.$inferInsert;
