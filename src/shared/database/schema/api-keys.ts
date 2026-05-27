import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * API keys for SDK / server-side event ingestion.
 *
 * Key design:
 *   - `keyHash` is SHA-256 of the plaintext key (never stored in plaintext).
 *   - `keyPrefix` is the first 12 chars of the plaintext (e.g. `wk_live_xxxx`)
 *     for display in the UI without exposing the full key.
 *   - `scope` is a comma-separated list of permissions (e.g. `events.write`).
 *   - `rateLimit` is the per-minute request cap for this key (0 = use workspace default).
 *
 * Lifecycle: active → revoked (soft delete via revokedAt).
 */
export const API_KEY_SCOPES = ['events.write', 'events.read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar({ length: 200 }).notNull(),
    /** SHA-256 hex of the plaintext key. */
    keyHash: varchar({ length: 128 }).notNull(),
    /** First 12 chars of the plaintext key — safe to display. */
    keyPrefix: varchar({ length: 16 }).notNull(),
    /** Comma-separated scopes, e.g. "events.write". */
    scope: varchar({ length: 256 }).notNull().default('events.write'),
    isActive: boolean().notNull().default(true),
    /** 0 = use workspace default. */
    rateLimit: integer().notNull().default(0),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_uniq').on(t.keyHash),
    index('api_keys_workspace_idx').on(t.workspaceId),
    index('api_keys_active_idx').on(t.workspaceId, t.isActive),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
