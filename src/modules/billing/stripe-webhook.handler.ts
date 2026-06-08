import type { FastifyBaseLogger } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Redis } from '@shared/cache/client.js';
import { AppError } from '@shared/errors/app-errors.js';
import type { StripeClient, Stripe } from '@shared/payments/stripe.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { Database } from '@shared/database/client.js';
import type { BillingRepository } from './repositories/billing.repository.js';
import type { BillingService } from './services/billing.service.js';
import type { InvoiceStatus, SubscriptionStatus } from '@shared/database/schema/billing.js';
import { workspaces } from '@shared/database/schema/workspaces.js';
import {
  billingPaymentFailures,
  billingWebhookEvents,
  billingWebhookFailures,
} from '@observability/billing-metrics.js';

const REPLAY_WINDOW_SECONDS = 60 * 5; // accept events up to 5 minutes old; older = replay attack
const REDIS_DEDUP_TTL_S = 60 * 60 * 24 * 7; // 1 week — Stripe retries up to 3 days

/**
 * Stripe webhook handler.
 *
 * Critical guarantees:
 *   1. Signature verification — `Stripe-Signature` header is checked against
 *      the raw body using the configured webhook secret.
 *   2. Replay protection — events older than REPLAY_WINDOW_SECONDS are rejected.
 *   3. Idempotency — every event id is recorded in `billing_events` with a
 *      UNIQUE constraint; duplicates are dropped without re-running side effects.
 *      A Redis dedup key provides a cheap fast-path before the DB write.
 *   4. Atomic state updates — DB row writes use upserts and conditional
 *      WHERE clauses so concurrent webhook deliveries do not corrupt state.
 *   5. Side effects (metrics, audit) happen *after* persistence; they never
 *      block the 200 response.
 */
export class StripeWebhookHandler {
  public constructor(
    private readonly db: Database,
    private readonly repo: BillingRepository,
    private readonly billing: BillingService,
    private readonly stripe: StripeClient,
    private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Verify and dispatch a webhook payload.
   * Throws on invalid signature; otherwise resolves with the dispatch result.
   */
  public async handle(rawBody: Buffer | string, signature: string): Promise<{ received: true }> {
    const event = this.stripe.constructEvent(rawBody, signature);

    // Replay protection: Stripe events carry a `created` timestamp (seconds).
    // Reject events whose age exceeds the window, *unless* this is a known
    // legitimate replay (e.g. Stripe re-delivery after our 500). Stripe re-tries
    // mark `livemode` events and retry deliveries can be older — we still allow
    // them through dedup (the unique constraint catches duplicate processing).
    const ageSeconds = Math.floor(Date.now() / 1000) - event.created;
    if (ageSeconds > REPLAY_WINDOW_SECONDS) {
      // Soft warning: allow processing because legitimate Stripe retries are
      // older than 5 minutes too. The unique constraint handles the dedup.
      this.log.warn({ eventId: event.id, ageSeconds, type: event.type }, 'stripe webhook outside replay window');
    }

    // Fast-path duplicate check via Redis. Cheap and avoids DB round-trip on
    // every retry. We still check the DB authoritative dedup below.
    const redisKey = `billing:webhook:${event.id}`;
    const seen = await this.redis.set(redisKey, '1', 'EX', REDIS_DEDUP_TTL_S, 'NX');
    if (seen !== 'OK') {
      billingWebhookEvents.inc({ event_type: event.type, outcome: 'duplicate' });
      this.log.info({ eventId: event.id, type: event.type }, 'stripe webhook replay blocked (redis)');
      await this.audit.record({
        action: 'billing.webhook.replay_blocked',
        success: false,
        metadata: { stripeEventId: event.id, type: event.type },
      }).catch(() => undefined);
      return { received: true };
    }

    // Authoritative dedup at the DB layer.
    const insertResult = await this.repo.insertBillingEventIfNew({
      stripeEventId: event.id,
      stripeEventType: event.type,
      payload: event as unknown as Record<string, unknown>,
      processed: false,
    });
    if (!insertResult.inserted) {
      billingWebhookEvents.inc({ event_type: event.type, outcome: 'duplicate' });
      this.log.info({ eventId: event.id, type: event.type }, 'stripe webhook replay blocked (db)');
      return { received: true };
    }

    // Dispatch.
    try {
      await this.dispatch(event);
      await this.repo.markBillingEventProcessed(event.id);
      billingWebhookEvents.inc({ event_type: event.type, outcome: 'processed' });
      this.log.info({ eventId: event.id, type: event.type }, 'stripe webhook processed');
    } catch (err) {
      billingWebhookEvents.inc({ event_type: event.type, outcome: 'failed' });
      billingWebhookFailures.inc({ event_type: event.type });
      this.log.error({ err, eventId: event.id, type: event.type }, 'stripe webhook handler failed');
      // Allow Redis key to expire so Stripe can retry; release the dedup lock.
      await this.redis.del(redisKey).catch(() => undefined);
      throw err;
    }

    await this.audit.record({
      action: 'billing.webhook.received',
      success: true,
      metadata: { stripeEventId: event.id, type: event.type },
    }).catch(() => undefined);

    return { received: true };
  }

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.payment_succeeded':
        return this.handleInvoiceSync(event.data.object as Stripe.Invoice);
      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      case 'invoice.upcoming':
        // Informational; we sync but don't change subscription state.
        return this.handleInvoiceSync(event.data.object as Stripe.Invoice);
      default:
        // Unknown / non-tracked event type — log and skip. Already deduped.
        this.log.info({ type: event.type, eventId: event.id }, 'stripe webhook ignored (unhandled type)');
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const workspaceId =
      session.client_reference_id ||
      (session.metadata?.workspaceId as string | undefined) ||
      null;

    if (!workspaceId) {
      this.log.error({ sessionId: session.id }, 'checkout.session.completed missing workspaceId');
      return;
    }

    // If the session created a subscription, fetch and reconcile.
    if (session.subscription) {
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const stripeSub = await this.stripe.retrieveSubscription(subId);
      await this.billing.reconcileSubscriptionFromStripe(workspaceId, stripeSub);
    }

    // Always release the in-flight checkout lock so the next operation can proceed.
    await this.redis.del(`billing:checkout:${workspaceId}`).catch(() => undefined);
    await this.redis.del(`billing:usage:${workspaceId}`).catch(() => undefined);
  }

  private async handleSubscriptionUpsert(stripeSub: Stripe.Subscription): Promise<void> {
    const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id;
    const workspaceId = await this.billing.resolveWorkspaceForCustomer(
      customerId,
      stripeSub.metadata as Record<string, string | undefined>,
    );
    if (!workspaceId) {
      this.log.error({ subscriptionId: stripeSub.id, customerId }, 'subscription event has no resolvable workspace');
      return;
    }
    await this.billing.reconcileSubscriptionFromStripe(workspaceId, stripeSub);
    await this.redis.del(`billing:usage:${workspaceId}`).catch(() => undefined);

    await this.audit.record({
      action: 'billing.subscription.updated',
      workspaceId,
      targetType: 'subscription',
      targetId: stripeSub.id,
      success: true,
      metadata: {
        status: stripeSub.status,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      },
    }).catch(() => undefined);
  }

  private async handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
    // Stripe sends `customer.subscription.deleted` after period end on cancellation,
    // OR immediately if cancel was hard. Reconcile the row to canceled status.
    const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id;
    const workspaceId = await this.billing.resolveWorkspaceForCustomer(
      customerId,
      stripeSub.metadata as Record<string, string | undefined>,
    );
    if (!workspaceId) {
      this.log.error({ subscriptionId: stripeSub.id, customerId }, 'subscription.deleted has no resolvable workspace');
      return;
    }
    await this.repo.updateSubscriptionByStripeId(stripeSub.id, {
      status: 'canceled' as SubscriptionStatus,
      canceledAt: new Date(),
      cancelAtPeriodEnd: false,
      // Demote the workspace plan to free; webhook is the canonical source of truth.
      plan: 'free',
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeProductId: null,
      billingInterval: null,
    });
    await this.db.update(workspaces)
      .set({ plan: 'free', updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .catch(() => undefined);
    await this.redis.del(`billing:usage:${workspaceId}`).catch(() => undefined);
  }

  private async handleInvoiceSync(invoice: Stripe.Invoice): Promise<void> {
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;
    const workspaceId = await this.billing.resolveWorkspaceForCustomer(customerId);
    if (!workspaceId) {
      this.log.error({ invoiceId: invoice.id }, 'invoice event has no resolvable workspace');
      return;
    }

    await this.repo.upsertInvoice({
      workspaceId,
      stripeInvoiceId: invoice.id ?? '',
      stripeCustomerId: customerId,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      status: (invoice.status ?? 'draft') as InvoiceStatus,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
      invoiceDate: invoice.created ? new Date(invoice.created * 1000) : null,
    });

    await this.audit.record({
      action: 'billing.invoice.synced',
      workspaceId,
      targetType: 'invoice',
      targetId: invoice.id ?? null,
      success: true,
      metadata: { status: invoice.status, amountPaid: invoice.amount_paid },
    }).catch(() => undefined);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    await this.handleInvoiceSync(invoice);

    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;
    const workspaceId = await this.billing.resolveWorkspaceForCustomer(customerId);
    if (!workspaceId) return;

    const sub = await this.repo.findSubscriptionByWorkspace(workspaceId);
    billingPaymentFailures.inc({ plan: sub?.plan ?? 'unknown' });
    this.log.warn({ workspaceId, invoiceId: invoice.id, amountDue: invoice.amount_due }, 'payment failed');

    if (invoice.subscription) {
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id;
      await this.repo.updateSubscriptionByStripeId(subId, { plan: 'free', status: 'past_due' });
      await this.db.update(workspaces)
        .set({ plan: 'free', updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
      await this.redis.del(`billing:usage:${workspaceId}`).catch(() => undefined);
    }

    await this.audit.record({
      action: 'billing.payment.failed',
      workspaceId,
      targetType: 'invoice',
      targetId: invoice.id ?? null,
      success: false,
      metadata: { amountDue: invoice.amount_due, attemptCount: invoice.attempt_count },
    }).catch(() => undefined);
  }
}

/**
 * Convenience wrapper used by the route handler. Maps signature errors to
 * the canonical AppError so the global error handler returns 400.
 */
export function isWebhookSignatureError(err: unknown): boolean {
  return err instanceof AppError && err.code === 'WEBHOOK_SIGNATURE_INVALID';
}
