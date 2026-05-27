import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
  billingEvents,
  invoices,
  subscriptions,
  usageCounters,
  type BillingEvent,
  type Invoice,
  type NewBillingEvent,
  type NewInvoice,
  type NewSubscription,
  type NewUsageCounter,
  type Subscription,
  type UsageCounter,
} from '@shared/database/schema/billing.js';
import type { Database } from '@shared/database/client.js';
import type { QuotaMetric } from '@constants/plan-limits.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Billing data-access layer.
 *
 * Tenant isolation invariants:
 *   - Every read/write that selects a single subscription/invoice pairs the id
 *     (or stripe id) with `workspaceId` in WHERE clauses where the caller
 *     supplies workspace context.
 *   - Webhook-driven writes (`upsertSubscriptionFromWebhook`, etc.) lookup by
 *     stripe id and rely on the FK uniqueness; the workspace_id is set from
 *     the subscription metadata at customer creation time.
 */
export class BillingRepository {
  public constructor(private readonly db: Database) {}

  // ─── Subscriptions ────────────────────────────────────────────────────────

  public async findSubscriptionByWorkspace(workspaceId: string): Promise<Subscription | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    return rows[0] ?? null;
  }

  public async findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return rows[0] ?? null;
  }

  public async findSubscriptionByCustomerId(stripeCustomerId: string): Promise<Subscription | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
      .limit(1);
    return rows[0] ?? null;
  }

  public async upsertSubscription(values: NewSubscription): Promise<Subscription> {
    /**
     * Workspace-scoped upsert. The unique constraint on (workspace_id) means
     * every workspace has at most one subscription row, so on conflict we
     * patch the existing row with the latest Stripe state.
     */
    const rows = await this.db
      .insert(subscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: subscriptions.workspaceId,
        set: {
          stripeCustomerId: values.stripeCustomerId,
          stripeSubscriptionId: values.stripeSubscriptionId,
          stripePriceId: values.stripePriceId,
          stripeProductId: values.stripeProductId,
          plan: values.plan,
          billingInterval: values.billingInterval,
          status: values.status,
          cancelAtPeriodEnd: values.cancelAtPeriodEnd,
          currentPeriodStart: values.currentPeriodStart,
          currentPeriodEnd: values.currentPeriodEnd,
          trialEndsAt: values.trialEndsAt,
          canceledAt: values.canceledAt,
        },
      })
      .returning();
    return rows[0]!;
  }

  public async updateSubscriptionByStripeId(
    stripeSubscriptionId: string,
    patch: Partial<Omit<Subscription, 'id' | 'workspaceId' | 'createdAt'>>,
  ): Promise<Subscription | null> {
    const rows = await this.db
      .update(subscriptions)
      .set(patch)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .returning();
    return rows[0] ?? null;
  }

  public async setStripeCustomerId(
    workspaceId: string,
    stripeCustomerId: string,
  ): Promise<Subscription> {
    /**
     * Atomic upsert that sets the customer id without disturbing the rest of
     * the row. Used the first time we register a workspace with Stripe.
     */
    const rows = await this.db
      .insert(subscriptions)
      .values({
        workspaceId,
        stripeCustomerId,
        plan: 'free',
        status: 'active',
      })
      .onConflictDoUpdate({
        target: subscriptions.workspaceId,
        set: { stripeCustomerId },
      })
      .returning();
    return rows[0]!;
  }

  // ─── Billing events (webhook idempotency) ─────────────────────────────────

  public async insertBillingEventIfNew(
    values: NewBillingEvent,
  ): Promise<{ inserted: boolean; row: BillingEvent }> {
    /**
     * Duplicate Stripe event ids are silently dropped at the DB layer thanks
     * to the UNIQUE constraint. We use ON CONFLICT DO NOTHING so the second
     * webhook delivery returns 200 without re-running side effects.
     */
    const inserted = await this.db
      .insert(billingEvents)
      .values(values)
      .onConflictDoNothing({ target: billingEvents.stripeEventId })
      .returning();

    if (inserted[0]) {
      return { inserted: true, row: inserted[0] };
    }
    const existing = await this.db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.stripeEventId, values.stripeEventId))
      .limit(1);
    return { inserted: false, row: existing[0]! };
  }

  public async markBillingEventProcessed(stripeEventId: string): Promise<void> {
    await this.db
      .update(billingEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(billingEvents.stripeEventId, stripeEventId));
  }

  // ─── Invoices ─────────────────────────────────────────────────────────────

  public async upsertInvoice(values: NewInvoice): Promise<Invoice> {
    const rows = await this.db
      .insert(invoices)
      .values(values)
      .onConflictDoUpdate({
        target: invoices.stripeInvoiceId,
        set: {
          amountDue: values.amountDue,
          amountPaid: values.amountPaid,
          currency: values.currency,
          status: values.status,
          hostedInvoiceUrl: values.hostedInvoiceUrl,
          invoicePdf: values.invoicePdf,
          invoiceDate: values.invoiceDate,
        },
      })
      .returning();
    return rows[0]!;
  }

  public async listInvoices(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: Invoice[]; total: number }> {
    const conds = [eq(invoices.workspaceId, workspaceId)];
    const offset = (page - 1) * pageSize;
    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(invoices)
        .where(and(...conds))
        .orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ c: count() }).from(invoices).where(and(...conds)),
    ]);
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  // ─── Usage counters ───────────────────────────────────────────────────────

  public async getUsageForPeriod(
    workspaceId: string,
    metric: QuotaMetric,
    periodStart: Date,
  ): Promise<UsageCounter | null> {
    const rows = await this.db
      .select()
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.workspaceId, workspaceId),
          eq(usageCounters.metric, metric),
          eq(usageCounters.periodStart, periodStart),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  public async getAllUsageForPeriod(
    workspaceId: string,
    periodStart: Date,
  ): Promise<UsageCounter[]> {
    return this.db
      .select()
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.workspaceId, workspaceId),
          eq(usageCounters.periodStart, periodStart),
        ),
      );
  }

  /**
   * Atomic increment of a usage counter for a billing period.
   *
   * Concurrency:
   *   Multiple writers (e.g. webhook delivery + transactional send burst) may
   *   hit this row in parallel. We use ON CONFLICT DO UPDATE with a
   *   self-referential SET so the increment happens at the SQL level — no
   *   read-modify-write race in application code.
   */
  public async incrementUsage(
    tx: Tx | Database,
    values: NewUsageCounter,
    delta: number,
  ): Promise<UsageCounter> {
    const rows = await tx
      .insert(usageCounters)
      .values({ ...values, usageCount: delta })
      .onConflictDoUpdate({
        target: [usageCounters.workspaceId, usageCounters.metric, usageCounters.periodStart],
        set: {
          usageCount: sql`${usageCounters.usageCount} + ${delta}`,
        },
      })
      .returning();
    return rows[0]!;
  }
}
