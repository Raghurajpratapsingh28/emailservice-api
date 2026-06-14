import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '@modules/billing/services/billing.service.js';
import { ConflictError, ForbiddenError, ValidationError } from '@shared/errors/app-errors.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findSubscriptionByWorkspace: vi.fn().mockResolvedValue(null),
    findSubscriptionByStripeId: vi.fn(),
    findSubscriptionByCustomerId: vi.fn(),
    upsertSubscription: vi.fn(),
    updateSubscriptionByStripeId: vi.fn(),
    setStripeCustomerId: vi.fn().mockResolvedValue({ stripeCustomerId: 'cus_test' }),
    insertBillingEventIfNew: vi.fn(),
    markBillingEventProcessed: vi.fn(),
    upsertInvoice: vi.fn(),
    listInvoices: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getUsageForPeriod: vi.fn(),
    getAllUsageForPeriod: vi.fn().mockResolvedValue([]),
    incrementUsage: vi.fn(),
    ...overrides,
  };
}

function makeStripe(overrides: Record<string, unknown> = {}) {
  return {
    raw: {} as never,
    resolvePriceId: vi.fn().mockReturnValue('price_test'),
    createCheckoutSession: vi.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test/cs_test' }),
    createBillingPortalSession: vi.fn().mockResolvedValue({ url: 'https://portal.stripe.test/x' }),
    createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test' }),
    retrieveSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    constructEvent: vi.fn(),
    ...overrides,
  };
}

function makeRedis(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string, _exFlag: unknown, _exVal: unknown, nxFlag?: unknown) => {
      if (nxFlag === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
    ...overrides,
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeLog() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: 'ws-1', name: 'Test WS', ownerUserId: 'user-1' }]),
        })),
      })),
    })),
    transaction: vi.fn(),
  };
}

const actor = { user: { id: 'user-1', email: 'owner@test.com' }, ipAddress: '127.0.0.1' };
const workspaceId = 'ws-1';

describe('BillingService', () => {
  describe('createCheckoutSession', () => {
    it('creates a session for a new workspace', async () => {
      const repo = makeRepo();
      const stripe = makeStripe();
      const svc = new BillingService(makeDb() as never, repo as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.createCheckoutSession(workspaceId, { plan: 'growth', billingInterval: 'monthly' }, actor);
      expect(result.checkoutUrl).toContain('checkout.stripe');
      expect(stripe.createCheckoutSession).toHaveBeenCalled();
    });

    it('rejects free plan in checkout', async () => {
      const svc = new BillingService(makeDb() as never, makeRepo() as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);
      // @ts-expect-error — runtime guard
      await expect(svc.createCheckoutSession(workspaceId, { plan: 'free', billingInterval: 'monthly' }, actor))
        .rejects.toThrow(ValidationError);
    });

    it('rejects concurrent checkout (Redis lock NX)', async () => {
      const redis = makeRedis();
      // Pre-set the key in redis store to simulate concurrent checkout
      await redis.set(`billing:checkout:${workspaceId}`, 'some-user', 'EX', 60, 'NX');

      const svc = new BillingService(makeDb() as never, makeRepo() as never, makeStripe() as never, redis as never, makeAudit() as never, makeLog() as never);

      await expect(svc.createCheckoutSession(workspaceId, { plan: 'starter', billingInterval: 'monthly' }, actor))
        .rejects.toThrow(ConflictError);
    });

    it('rejects when an active paid subscription already exists', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({
          stripeSubscriptionId: 'sub_existing',
          status: 'active',
        }),
      });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.createCheckoutSession(workspaceId, { plan: 'pro', billingInterval: 'monthly' }, actor))
        .rejects.toThrow(ConflictError);
    });

    it('releases the lock on Stripe error so user can retry', async () => {
      const stripe = makeStripe({
        createCheckoutSession: vi.fn().mockRejectedValue(new Error('stripe down')),
      });
      const redis = makeRedis();
      const svc = new BillingService(makeDb() as never, makeRepo() as never, stripe as never, redis as never, makeAudit() as never, makeLog() as never);

      await expect(svc.createCheckoutSession(workspaceId, { plan: 'growth', billingInterval: 'monthly' }, actor))
        .rejects.toThrow();
      // Second attempt should not be locked.
      await expect(svc.createCheckoutSession(workspaceId, { plan: 'growth', billingInterval: 'monthly' }, actor))
        .rejects.toThrow();
      // Confirm `del` was called to release the lock.
      expect(redis.del).toHaveBeenCalledWith(`billing:checkout:${workspaceId}`);
    });
  });

  describe('changePlan', () => {
    it('throws ACTIVE_SUBSCRIPTION_REQUIRED if no subscription', async () => {
      const repo = makeRepo({ findSubscriptionByWorkspace: vi.fn().mockResolvedValue(null) });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);
      await expect(svc.changePlan(workspaceId, { plan: 'pro', billingInterval: 'monthly' }, actor))
        .rejects.toThrow(ForbiddenError);
    });

    it('updates Stripe subscription and reconciles DB', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({
          stripeSubscriptionId: 'sub_test',
          plan: 'starter',
          status: 'active',
        }),
        upsertSubscription: vi.fn().mockResolvedValue({
          plan: 'pro',
          billingInterval: 'monthly',
          status: 'active',
        }),
      });
      const stripe = makeStripe({
        retrieveSubscription: vi.fn().mockResolvedValue({
          id: 'sub_test',
          customer: 'cus_test',
          items: { data: [{ id: 'si_test', price: { id: 'price_test', product: 'prod_test' } }] },
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          canceled_at: null,
        }),
        updateSubscription: vi.fn().mockResolvedValue({
          id: 'sub_test',
          customer: 'cus_test',
          items: { data: [{ id: 'si_test', price: { id: 'price_test_pro', product: 'prod_pro' } }] },
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          canceled_at: null,
        }),
      });
      const svc = new BillingService(makeDb() as never, repo as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.changePlan(workspaceId, { plan: 'pro', billingInterval: 'monthly' }, actor);
      expect(result.plan).toBe('pro');
      expect(stripe.updateSubscription).toHaveBeenCalledWith('sub_test', expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ id: 'si_test' })]),
        proration_behavior: 'create_prorations',
      }));
    });
  });

  describe('cancelSubscription', () => {
    it('cancels at period end (not immediately)', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({
          stripeSubscriptionId: 'sub_test',
        }),
        updateSubscriptionByStripeId: vi.fn().mockResolvedValue({
          status: 'active',
          cancelAtPeriodEnd: true,
        }),
      });
      const stripe = makeStripe({
        cancelSubscription: vi.fn().mockResolvedValue({
          id: 'sub_test',
          status: 'active',
          cancel_at_period_end: true,
          canceled_at: 1700000000,
        }),
      });
      const svc = new BillingService(makeDb() as never, repo as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.cancelSubscription(workspaceId, actor);
      expect(stripe.cancelSubscription).toHaveBeenCalledWith('sub_test', true);
      expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it('throws ACTIVE_SUBSCRIPTION_REQUIRED when no subscription', async () => {
      const repo = makeRepo({ findSubscriptionByWorkspace: vi.fn().mockResolvedValue(null) });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);
      await expect(svc.cancelSubscription(workspaceId, actor)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('resumeSubscription', () => {
    it('resumes a pending cancellation', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({
          stripeSubscriptionId: 'sub_test',
          cancelAtPeriodEnd: true,
        }),
        updateSubscriptionByStripeId: vi.fn().mockResolvedValue({
          status: 'active',
          cancelAtPeriodEnd: false,
        }),
      });
      const stripe = makeStripe({
        resumeSubscription: vi.fn().mockResolvedValue({
          id: 'sub_test',
          status: 'active',
          cancel_at_period_end: false,
          canceled_at: null,
        }),
      });
      const svc = new BillingService(makeDb() as never, repo as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.resumeSubscription(workspaceId, actor);
      expect(result.cancelAtPeriodEnd).toBe(false);
    });

    it('rejects resume when not pending cancellation', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({
          stripeSubscriptionId: 'sub_test',
          cancelAtPeriodEnd: false,
        }),
      });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);
      await expect(svc.resumeSubscription(workspaceId, actor)).rejects.toThrow(ValidationError);
    });
  });

  describe('getSubscription', () => {
    it('returns synthetic free record when no row exists', async () => {
      const repo = makeRepo({ findSubscriptionByWorkspace: vi.fn().mockResolvedValue(null) });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const sub = await svc.getSubscription(workspaceId);
      expect(sub.plan).toBe('free');
      expect(sub.status).toBe('active');
      expect(sub.stripeSubscriptionId).toBeNull();
    });
  });

  describe('getUsage', () => {
    it('returns zero usage for fresh workspace on free plan', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue(null),
        getAllUsageForPeriod: vi.fn().mockResolvedValue([]),
      });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const usage = await svc.getUsage(workspaceId);
      expect(usage.contacts.used).toBe(0);
      expect(usage.contacts.limit).toBe(1000);
      expect(usage.emails.used).toBe(0);
      expect(usage.events.used).toBe(0);
    });

    it('aggregates counters and applies plan limits', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({
          plan: 'growth',
          currentPeriodStart: new Date('2026-01-01'),
          currentPeriodEnd: new Date('2026-02-01'),
        }),
        getAllUsageForPeriod: vi.fn().mockResolvedValue([
          { metric: 'contacts', usageCount: 1200 },
          { metric: 'emails', usageCount: 50000 },
          { metric: 'events', usageCount: 250000 },
        ]),
      });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const usage = await svc.getUsage(workspaceId);
      expect(usage.contacts).toEqual({ used: 1200, limit: 50_000 });
      expect(usage.emails).toEqual({ used: 50000, limit: 150_000 });
      expect(usage.events).toEqual({ used: 250000, limit: 500_000 });
    });
  });

  describe('hasQuotaRemaining', () => {
    it('returns true when under limit', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({ plan: 'free' }),
        getAllUsageForPeriod: vi.fn().mockResolvedValue([{ metric: 'contacts', usageCount: 50 }]),
      });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);
      expect(await svc.hasQuotaRemaining(workspaceId, 'contacts', 1)).toBe(true);
    });

    it('returns false when delta would exceed limit', async () => {
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({ plan: 'free' }),
        getAllUsageForPeriod: vi.fn().mockResolvedValue([{ metric: 'contacts', usageCount: 1000 }]),
      });
      const svc = new BillingService(makeDb() as never, repo as never, makeStripe() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);
      expect(await svc.hasQuotaRemaining(workspaceId, 'contacts', 1)).toBe(false);
    });
  });
});
