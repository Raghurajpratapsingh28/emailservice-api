import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    stripeCustomerId: varchar({ length: 64 }),
    stripeSubscriptionId: varchar({ length: 64 }),
    stripePriceId: varchar({ length: 64 }),
    stripeProductId: varchar({ length: 64 }),
    plan: varchar({ length: 32 }).notNull().default('free'),
    billingInterval: varchar({ length: 16 }),
    status: varchar({ length: 32 }).notNull().default('active'),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    currentPeriodStart: timestamp({ withTimezone: true }),
    currentPeriodEnd: timestamp({ withTimezone: true }),
    trialEndsAt: timestamp({ withTimezone: true }),
    canceledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    /** Exactly one subscription row per workspace. */
    uniqueIndex('subscriptions_workspace_uniq').on(t.workspaceId),
    index('subscriptions_stripe_customer_idx').on(t.stripeCustomerId),
    index('subscriptions_stripe_subscription_idx').on(t.stripeSubscriptionId),
    index('subscriptions_status_idx').on(t.status),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

/**
 * Append-only audit of every Stripe webhook event we've processed.
 * Primary use:
 *   - Idempotent webhook processing — `stripeEventId` is UNIQUE.
 *   - Forensic replay — we keep the raw payload to reconstruct state.
 */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().references(() => workspaces.id, { onDelete: 'set null' }),
    stripeEventId: varchar({ length: 64 }).notNull(),
    stripeEventType: varchar({ length: 100 }).notNull(),
    payload: jsonb().notNull(),
    processed: boolean().notNull().default(false),
    processedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('billing_events_stripe_event_uniq').on(t.stripeEventId),
    index('billing_events_workspace_idx').on(t.workspaceId),
    index('billing_events_type_idx').on(t.stripeEventType),
  ],
);

export type BillingEvent = typeof billingEvents.$inferSelect;
export type NewBillingEvent = typeof billingEvents.$inferInsert;

/**
 * Usage counters per (workspace, metric, billing period).
 * Updated atomically by the modules that meter usage:
 *   - contacts module increments `contacts` on create.
 *   - transactional/campaigns increment `emails` on send.
 *   - events module increments `events` on ingestion.
 *
 * Period bounds align with the active subscription's billing period; for
 * free-plan workspaces we use calendar months.
 */
export const QUOTA_METRICS = ['contacts', 'emails', 'events'] as const;
export type QuotaMetric = (typeof QUOTA_METRICS)[number];

export const usageCounters = pgTable(
  'usage_counters',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    metric: varchar({ length: 32 }).notNull(),
    periodStart: timestamp({ withTimezone: true }).notNull(),
    periodEnd: timestamp({ withTimezone: true }).notNull(),
    /** bigint to allow > 2B counts on enterprise plans without hitting int32. */
    usageCount: bigint({ mode: 'number' }).notNull().default(0),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    /** One row per (workspace, metric, period). Used as the upsert target. */
    uniqueIndex('usage_counters_workspace_metric_period_uniq').on(
      t.workspaceId,
      t.metric,
      t.periodStart,
    ),
    index('usage_counters_workspace_idx').on(t.workspaceId),
  ],
);

export type UsageCounter = typeof usageCounters.$inferSelect;
export type NewUsageCounter = typeof usageCounters.$inferInsert;

export const INVOICE_STATUSES = [
  'draft',
  'open',
  'paid',
  'uncollectible',
  'void',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoices = pgTable(
  'invoices',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    stripeInvoiceId: varchar({ length: 64 }).notNull(),
    stripeCustomerId: varchar({ length: 64 }),
    /** Stored in the smallest currency unit (cents) to avoid float arithmetic. */
    amountDue: bigint({ mode: 'number' }).notNull().default(0),
    amountPaid: bigint({ mode: 'number' }).notNull().default(0),
    currency: varchar({ length: 8 }).notNull().default('usd'),
    status: varchar({ length: 32 }).notNull().default('draft'),
    hostedInvoiceUrl: text(),
    invoicePdf: text(),
    invoiceDate: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    uniqueIndex('invoices_stripe_invoice_uniq').on(t.stripeInvoiceId),
    index('invoices_workspace_idx').on(t.workspaceId),
    index('invoices_status_idx').on(t.status),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
