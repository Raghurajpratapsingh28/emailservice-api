import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Workspaces (tenants). Each user signing up gets a personal workspace by default;
 * users may belong to multiple workspaces via `workspace_members`.
 *
 * Status lifecycle:
 *   active  → normal operation
 *   inactive → deactivated by owner; API access blocked except reactivate
 *   deleted → soft-deleted (via deletedAt) — retained for grace period
 *
 * `version` is used for optimistic concurrency on PATCH operations.
 */
export const WORKSPACE_STATUS = ['active', 'inactive', 'deleted'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUS)[number];

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: varchar({ length: 64 }).notNull(),
    name: varchar({ length: 200 }).notNull(),
    plan: varchar({ length: 32 }).notNull().default('free'),
    status: varchar({ length: 16 }).notNull().default('active'),
    ownerUserId: uuid().notNull(),
    metadata: jsonb().notNull().default(sql`'{}'::jsonb`),
    /** Optimistic concurrency token — bumped on every UPDATE. */
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('workspaces_slug_uniq').on(t.slug),
    index('workspaces_owner_idx').on(t.ownerUserId),
    index('workspaces_plan_idx').on(t.plan),
    index('workspaces_status_idx').on(t.status),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
