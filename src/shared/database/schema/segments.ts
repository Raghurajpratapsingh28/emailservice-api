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
import { users } from './users.js';
import { workspaces } from './workspaces.js';
import { contacts } from './contacts.js';

export const SEGMENT_STATUS = ['pending', 'computing', 'ready', 'failed'] as const;
export type SegmentStatus = (typeof SEGMENT_STATUS)[number];

export const SEGMENT_TYPES = ['static', 'dynamic'] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export const segments = pgTable(
  'segments',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar({ length: 200 }).notNull(),
    type: varchar({ length: 16 }).notNull().default('static'),
    filterTree: jsonb().notNull().default(sql`'{}'::jsonb`),
    contactCount: integer().notNull().default(0),
    status: varchar({ length: 16 }).notNull().default('pending'),
    lastComputed: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('segments_workspace_name_uniq').on(t.workspaceId, t.name),
    index('segments_workspace_idx').on(t.workspaceId),
    index('segments_status_idx').on(t.status),
    index('segments_type_idx').on(t.type),
  ],
);

export type Segment = typeof segments.$inferSelect;
export type NewSegment = typeof segments.$inferInsert;

export const segmentMemberships = pgTable(
  'segment_memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    segmentId: uuid()
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('segment_memberships_segment_contact_uniq').on(t.segmentId, t.contactId),
    index('segment_memberships_workspace_idx').on(t.workspaceId),
    index('segment_memberships_segment_idx').on(t.segmentId),
    index('segment_memberships_contact_idx').on(t.contactId),
  ],
);

export type SegmentMembership = typeof segmentMemberships.$inferSelect;
export type NewSegmentMembership = typeof segmentMemberships.$inferInsert;

// Filter tree DSL types
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'exists'
  | 'not_exists'
  | 'in'
  | 'not_in'
  | 'occurred_within_days';

export type LogicalOperator = 'AND' | 'OR';

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface FilterTree {
  operator: LogicalOperator;
  rules: Array<FilterRule | FilterTree>;
}
