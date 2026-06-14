import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from '@shared/cache/client.js';
import type { Database } from '@shared/database/client.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@shared/errors/app-errors.js';
import { workspaces } from '@shared/database/schema/workspaces.js';
import { users } from '@shared/database/schema/users.js';
import { eq } from 'drizzle-orm';
import {
  BILLING_PLANS,
  PLAN_RANK,
  quotasForPlan,
  type BillingInterval,
  type BillingPlan,
  type QuotaMetric,
} from '@constants/plan-limits.js';
import type { Subscription } from '@shared/database/schema/billing.js';
import type { StripeClient } from '@shared/payments/stripe.js';
import type { Stripe } from '@shared/payments/stripe.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { BillingRepository } from '../repositories/billing.repository.js';
import type {
  ChangePlanBody,
  CreateCheckoutBody,
  ListInvoicesQuery,
} from '../schemas/billing.schema.js';
import {
  billingActiveSubscriptions,
  billingCheckoutSessions,
  billingPlanDowngrades,
  billingPlanUpgrades,
} from '@observability/billing-metrics.js';

export interface ActorContext {
  user: { id: string; email: string };
  ipAddress?: string;
  userAgent?: string;
}

export interface UsageSnapshot {
  contacts: { used: number; limit: number };
  emails: { used: number; limit: number };
  events: { used: number; limit: number };
  periodStart: Date;
  periodEnd: Date;
}

const CHECKOUT_LOCK_TTL_S = 60; // shortest sane window for in-flight checkout
const USAGE_CACHE_TTL_S = 30;

/**
 * Billing service. All workspace-scoped operations require the caller to have
 * already passed `requirePermissions(billing.write)` (or `.read` for getters).
 */
export class BillingService {
  public constructor(
    private readonly db: Database,
    private readonly repo: BillingRepository,
    private readonly stripe: StripeClient,
    private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly log: FastifyBaseLogger,
  ) { }

  // ─── Checkout ─────────────────────────────────────────────────────────────

  public async createCheckoutSession(
    workspaceId: string,
    body: CreateCheckoutBody,
    actor: ActorContext,
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    if (!isPurchasablePlan(body.plan)) {
      throw new ValidationError(`Plan ${body.plan} is not purchasable via checkout`, {
        code: 'INVALID_PLAN',
      });
    }

    // Idempotency: prevent two concurrent /checkout calls from the same
    // workspace producing two Stripe sessions and double-charging on success.
    const lockKey = `billing:checkout:${workspaceId}`;
    const acquired = await this.redis.set(lockKey, actor.user.id, 'EX', CHECKOUT_LOCK_TTL_S, 'NX');
    if (!acquired) {
      throw new ConflictError('Checkout already in progress', 'CHECKOUT_ALREADY_IN_PROGRESS');
    }

    try {
      // Block re-purchase by workspaces with an active paid subscription.
      const existing = await this.repo.findSubscriptionByWorkspace(workspaceId);
      if (
        existing &&
        existing.stripeSubscriptionId &&
        ['active', 'trialing', 'past_due'].includes(existing.status)
      ) {
        throw new ConflictError(
          'Workspace already has an active subscription; use change-plan instead',
          'CHECKOUT_ALREADY_IN_PROGRESS',
        );
      }

      const customerId = await this.ensureStripeCustomer(workspaceId, actor.user.email);
      const priceId = this.stripe.resolvePriceId(body.plan, body.billingInterval);

      const session = await this.stripe.createCheckoutSession({
        workspaceId,
        customerId,
        priceId,
        plan: body.plan,
        billingInterval: body.billingInterval,
        // Stripe-side idempotency — protects against retries inside Stripe's
        // own infrastructure as well as our retries.
        idempotencyKey: `checkout:${workspaceId}:${body.plan}:${body.billingInterval}:${Date.now()}`,
      });

      if (!session.url) {
        throw new AppError('Stripe did not return a checkout URL', { code: 'STRIPE_ERROR', statusCode: 502 });
      }

      billingCheckoutSessions.inc({ plan: body.plan, interval: body.billingInterval });
      this.log.info(
        { workspaceId, plan: body.plan, interval: body.billingInterval, sessionId: session.id },
        'billing checkout created',
      );

      await this.audit.record({
        action: 'billing.checkout.created',
        actorUserId: actor.user.id,
        workspaceId,
        targetType: 'subscription',
        targetId: customerId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        success: true,
        metadata: { plan: body.plan, billingInterval: body.billingInterval, sessionId: session.id },
      }).catch(() => undefined);

      // Release the lock now that we have a valid session URL. The webhook
      // handler also deletes it on checkout.session.completed; this early
      // release means a failed/abandoned checkout lets the user try again
      // immediately rather than waiting for the 60s TTL to expire.
      await this.redis.del(lockKey).catch(() => undefined);

      return { checkoutUrl: session.url, sessionId: session.id };
    } catch (err) {
      // Release the lock on any failure so the user can retry quickly.
      await this.redis.del(lockKey).catch(() => undefined);
      throw err;
    }
  }

  // ─── Customer portal ──────────────────────────────────────────────────────

  public async createPortalSession(
    workspaceId: string,
    actor: ActorContext,
  ): Promise<{ url: string }> {
    const customerId = await this.ensureStripeCustomer(workspaceId, actor.user.email);
    const session = await this.stripe.createBillingPortalSession({ customerId });

    this.log.info({ workspaceId, customerId }, 'billing portal session created');
    await this.audit.record({
      action: 'billing.portal.created',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'customer',
      targetId: customerId,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return { url: session.url };
  }

  // ─── Subscription getter ──────────────────────────────────────────────────

  public async getSubscription(workspaceId: string): Promise<Subscription> {
    const sub = await this.repo.findSubscriptionByWorkspace(workspaceId);
    if (!sub) {
      // Return a synthetic free-plan record so the UI always has something to render.
      return {
        id: workspaceId,
        workspaceId,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        stripeProductId: null,
        plan: 'free',
        billingInterval: null,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialEndsAt: null,
        canceledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Subscription;
    }
    return sub;
  }

  // ─── Plan changes ─────────────────────────────────────────────────────────

  public async changePlan(
    workspaceId: string,
    body: ChangePlanBody,
    actor: ActorContext,
  ): Promise<Subscription> {
    if (!isPurchasablePlan(body.plan)) {
      throw new ValidationError(`Plan ${body.plan} is not changeable`, { code: 'INVALID_PLAN' });
    }

    const sub = await this.repo.findSubscriptionByWorkspace(workspaceId);
    if (!sub || !sub.stripeSubscriptionId) {
      throw new ForbiddenError('No active subscription for this workspace', 'ACTIVE_SUBSCRIPTION_REQUIRED');
    }

    // Only allow plan changes on statuses where Stripe will accept an update.
    // past_due is allowed because the user may be upgrading to resolve a payment
    // failure. canceled/incomplete_expired are terminal — they must go through checkout.
    const CHANGEABLE_STATUSES: string[] = ['active', 'trialing', 'past_due'];
    if (!CHANGEABLE_STATUSES.includes(sub.status)) {
      throw new ForbiddenError(
        `Cannot change plan on a subscription with status "${sub.status}"; please start a new subscription`,
        'ACTIVE_SUBSCRIPTION_REQUIRED',
      );
    }

    const fromPlan = sub.plan as BillingPlan;
    const toPlan = body.plan;
    const newPriceId = this.stripe.resolvePriceId(toPlan, body.billingInterval);

    // Retrieve current sub from Stripe to get the subscription item id we need
    // to swap. Local subscription rows don't store this since it can change.
    const stripeSub = await this.stripe.retrieveSubscription(sub.stripeSubscriptionId);
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) {
      throw new AppError('Subscription has no items', { code: 'STRIPE_ERROR', statusCode: 502 });
    }

    const updated = await this.stripe.updateSubscription(sub.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPriceId }],
      // Default Stripe behaviour: prorate immediately. For downgrades from yearly→monthly
      // operators may prefer 'create_prorations' (default) — we leave default.
      proration_behavior: 'create_prorations',
      metadata: {
        workspaceId,
        plan: toPlan,
        billingInterval: body.billingInterval,
      },
    });

    // Reconcile DB. Webhook will arrive shortly to confirm; doing it here too
    // gives the UI an immediate consistent read.
    const reconciled = await this.repo.upsertSubscription({
      workspaceId,
      stripeCustomerId: typeof updated.customer === 'string' ? updated.customer : updated.customer.id,
      stripeSubscriptionId: updated.id,
      stripePriceId: newPriceId,
      stripeProductId: priceProductId(updated),
      plan: toPlan,
      billingInterval: body.billingInterval,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodStart: tsToDate(updated.current_period_start),
      currentPeriodEnd: tsToDate(updated.current_period_end),
      canceledAt: tsToDate(updated.canceled_at),
    });

    if (PLAN_RANK[toPlan] > PLAN_RANK[fromPlan]) {
      billingPlanUpgrades.inc({ from_plan: fromPlan, to_plan: toPlan });
    } else if (PLAN_RANK[toPlan] < PLAN_RANK[fromPlan]) {
      billingPlanDowngrades.inc({ from_plan: fromPlan, to_plan: toPlan });
    }

    this.log.info({ workspaceId, fromPlan, toPlan, interval: body.billingInterval }, 'billing plan changed');
    await this.audit.record({
      action: 'billing.plan.changed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'subscription',
      targetId: updated.id,
      ipAddress: actor.ipAddress,
      success: true,
      metadata: { fromPlan, toPlan, interval: body.billingInterval },
    }).catch(() => undefined);

    return reconciled;
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  public async cancelSubscription(workspaceId: string, actor: ActorContext): Promise<Subscription> {
    const sub = await this.repo.findSubscriptionByWorkspace(workspaceId);
    if (!sub || !sub.stripeSubscriptionId) {
      throw new ForbiddenError('No active subscription for this workspace', 'ACTIVE_SUBSCRIPTION_REQUIRED');
    }

    const updated = await this.stripe.cancelSubscription(sub.stripeSubscriptionId, true);
    const reconciled = await this.repo.updateSubscriptionByStripeId(updated.id, {
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      canceledAt: tsToDate(updated.canceled_at),
    });

    this.log.info({ workspaceId, subscriptionId: sub.stripeSubscriptionId }, 'billing subscription canceled at period end');
    await this.audit.record({
      action: 'billing.subscription.canceled',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'subscription',
      targetId: updated.id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return reconciled ?? sub;
  }

  // ─── Resume ───────────────────────────────────────────────────────────────

  public async resumeSubscription(workspaceId: string, actor: ActorContext): Promise<Subscription> {
    const sub = await this.repo.findSubscriptionByWorkspace(workspaceId);
    if (!sub || !sub.stripeSubscriptionId) {
      throw new ForbiddenError('No active subscription for this workspace', 'ACTIVE_SUBSCRIPTION_REQUIRED');
    }
    if (!sub.cancelAtPeriodEnd) {
      throw new ValidationError('Subscription is not pending cancellation', {
        code: 'INVALID_WORKFLOW_STATE',
      });
    }

    const updated = await this.stripe.resumeSubscription(sub.stripeSubscriptionId);
    const reconciled = await this.repo.updateSubscriptionByStripeId(updated.id, {
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      canceledAt: tsToDate(updated.canceled_at),
    });

    this.log.info({ workspaceId, subscriptionId: sub.stripeSubscriptionId }, 'billing subscription resumed');
    await this.audit.record({
      action: 'billing.subscription.resumed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'subscription',
      targetId: updated.id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return reconciled ?? sub;
  }

  // ─── Invoices ─────────────────────────────────────────────────────────────

  public async listInvoices(workspaceId: string, query: ListInvoicesQuery) {
    const { items, total } = await this.repo.listInvoices(workspaceId, query.page, query.pageSize);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  // ─── Usage ────────────────────────────────────────────────────────────────

  public async getUsage(workspaceId: string): Promise<UsageSnapshot> {
    const cacheKey = `billing:usage:${workspaceId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as UsageSnapshot & { periodStart: string; periodEnd: string };
        return {
          ...parsed,
          periodStart: new Date(parsed.periodStart),
          periodEnd: new Date(parsed.periodEnd),
        };
      } catch {
        // fall through and recompute
      }
    }

    const sub = await this.repo.findSubscriptionByWorkspace(workspaceId);
    const plan = (sub?.plan as BillingPlan | undefined) ?? 'free';
    const limits = quotasForPlan(plan);
    const { periodStart, periodEnd } = resolvePeriod(sub);

    const counters = await this.repo.getAllUsageForPeriod(workspaceId, periodStart);
    const byMetric = new Map<QuotaMetric, number>();
    for (const c of counters) {
      byMetric.set(c.metric as QuotaMetric, Number(c.usageCount));
    }

    const snapshot: UsageSnapshot = {
      contacts: { used: byMetric.get('contacts') ?? 0, limit: limits.contacts },
      emails: { used: byMetric.get('emails') ?? 0, limit: limits.emails },
      events: { used: byMetric.get('events') ?? 0, limit: limits.events },
      periodStart,
      periodEnd,
    };

    await this.redis
      .set(cacheKey, JSON.stringify(snapshot), 'EX', USAGE_CACHE_TTL_S)
      .catch(() => undefined);

    return snapshot;
  }

  /**
   * Public helper for other modules (contacts, emails, events) to record usage.
   * Increments are atomic at the SQL layer; concurrent callers cannot race.
   */
  public async recordUsage(
    workspaceId: string,
    metric: QuotaMetric,
    delta = 1,
  ): Promise<void> {
    if (delta <= 0) return;
    const sub = await this.repo.findSubscriptionByWorkspace(workspaceId);
    const { periodStart, periodEnd } = resolvePeriod(sub);
    await this.repo.incrementUsage(this.db, { workspaceId, metric, periodStart, periodEnd, usageCount: delta }, delta);
    await this.redis.del(`billing:usage:${workspaceId}`).catch(() => undefined);
  }

  /**
   * Public helper for quota enforcement. Returns true if the current usage +
   * delta would still be within the plan limit.
   */
  public async hasQuotaRemaining(
    workspaceId: string,
    metric: QuotaMetric,
    delta = 1,
  ): Promise<boolean> {
    const usage = await this.getUsage(workspaceId);
    const remaining = usage[metric].limit - usage[metric].used;
    return remaining >= delta;
  }

  // ─── Internal helpers used by the webhook handler ─────────────────────────

  /**
   * Webhook entry point: takes a Stripe.Subscription object and reconciles
   * the matching `subscriptions` row. Idempotent — safe to call from any
   * webhook event that contains a subscription.
   */
  public async reconcileSubscriptionFromStripe(
    workspaceId: string,
    stripeSub: Stripe.Subscription,
  ): Promise<Subscription> {
    const item = stripeSub.items.data[0];
    const priceId = item?.price.id ?? null;
    const productId = item?.price.product
      ? (typeof item.price.product === 'string' ? item.price.product : item.price.product.id)
      : null;
    const plan = (stripeSub.metadata?.plan as BillingPlan | undefined) ?? 'free';
    const interval = stripeSub.metadata?.billingInterval as BillingInterval | undefined ?? null;

    const result = await this.repo.upsertSubscription({
      workspaceId,
      stripeCustomerId: typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id,
      stripeSubscriptionId: stripeSub.id,
      stripePriceId: priceId,
      stripeProductId: productId,
      plan,
      billingInterval: interval,
      status: stripeSub.status,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      currentPeriodStart: tsToDate(stripeSub.current_period_start),
      currentPeriodEnd: tsToDate(stripeSub.current_period_end),
      trialEndsAt: tsToDate(stripeSub.trial_end),
      canceledAt: tsToDate(stripeSub.canceled_at),
    });
    billingActiveSubscriptions.set({ plan: result.plan }, 1);
    return result;
  }

  /**
   * Resolve workspace id for a webhook payload by looking up the
   * stripe_customer_id we cached when the subscription was first created.
   * Falls back to subscription metadata if available.
   */
  public async resolveWorkspaceForCustomer(
    customerId: string,
    metadata?: Record<string, string | undefined>,
  ): Promise<string | null> {
    if (metadata?.workspaceId) {
      return metadata.workspaceId;
    }
    const sub = await this.repo.findSubscriptionByCustomerId(customerId);
    return sub?.workspaceId ?? null;
  }

  // ─── Customer creation ────────────────────────────────────────────────────

  /**
   * Returns the Stripe customer id for a workspace, creating one if missing.
   * Idempotent: if we already have a row with a customer id, we return it.
   */
  private async ensureStripeCustomer(workspaceId: string, fallbackEmail: string): Promise<string> {
    const existing = await this.repo.findSubscriptionByWorkspace(workspaceId);
    if (existing?.stripeCustomerId) {
      return existing.stripeCustomerId;
    }

    const wsRows = await this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const ws = wsRows[0];
    if (!ws) throw new NotFoundError('Workspace not found', 'WORKSPACE_NOT_FOUND');

    let email = fallbackEmail;
    if (ws.ownerUserId) {
      const ownerRows = await this.db.select({ email: users.email }).from(users).where(eq(users.id, ws.ownerUserId)).limit(1);
      if (ownerRows[0]?.email) email = ownerRows[0].email;
    }

    const customer = await this.stripe.createCustomer({
      workspaceId,
      email,
      name: ws.name,
    });

    const updated = await this.repo.setStripeCustomerId(workspaceId, customer.id);
    return updated.stripeCustomerId!;
  }
}

// ─── Module-private helpers ─────────────────────────────────────────────────

function isPurchasablePlan(plan: string): plan is Exclude<BillingPlan, 'free'> {
  return BILLING_PLANS.includes(plan as BillingPlan) && plan !== 'free';
}

function tsToDate(ts: number | null | undefined): Date | null {
  if (ts === null || ts === undefined) return null;
  return new Date(ts * 1000);
}

function priceProductId(sub: Stripe.Subscription): string | null {
  const product = sub.items.data[0]?.price.product;
  if (!product) return null;
  return typeof product === 'string' ? product : product.id;
}

/**
 * Resolve the active billing period for usage aggregation.
 * - If there's a Stripe subscription with a current period, use that.
 * - Otherwise (free plan), use a calendar month bucket.
 */
function resolvePeriod(sub: Subscription | null): { periodStart: Date; periodEnd: Date } {
  if (sub?.currentPeriodStart && sub.currentPeriodEnd) {
    return { periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd };
  }
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}
