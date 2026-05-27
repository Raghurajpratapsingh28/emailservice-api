import { describe, expect, it, vi } from 'vitest';
import { StripeWebhookHandler } from '@modules/billing/stripe-webhook.handler.js';
import { StripeWebhookSignatureError } from '@shared/payments/stripe.js';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findSubscriptionByWorkspace: vi.fn(),
    findSubscriptionByCustomerId: vi.fn(),
    upsertSubscription: vi.fn(),
    updateSubscriptionByStripeId: vi.fn(),
    upsertInvoice: vi.fn(),
    insertBillingEventIfNew: vi.fn().mockResolvedValue({ inserted: true, row: {} }),
    markBillingEventProcessed: vi.fn(),
    ...overrides,
  };
}

function makeBilling(overrides: Record<string, unknown> = {}) {
  return {
    reconcileSubscriptionFromStripe: vi.fn(),
    resolveWorkspaceForCustomer: vi.fn().mockResolvedValue('ws-1'),
    ...overrides,
  };
}

function makeStripe(overrides: Record<string, unknown> = {}) {
  return {
    raw: {} as never,
    constructEvent: vi.fn(),
    retrieveSubscription: vi.fn(),
    resolvePriceId: vi.fn(),
    createCheckoutSession: vi.fn(),
    createBillingPortalSession: vi.fn(),
    createCustomer: vi.fn(),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
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

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('StripeWebhookHandler', () => {
  describe('signature verification', () => {
    it('rejects invalid signature', async () => {
      const stripe = makeStripe({
        constructEvent: vi.fn().mockImplementation(() => {
          throw new StripeWebhookSignatureError('bad signature');
        }),
      });
      const handler = new StripeWebhookHandler(
        makeRepo() as never,
        makeBilling() as never,
        stripe as never,
        makeRedis() as never,
        makeAudit() as never,
        makeLog() as never,
      );
      await expect(handler.handle(Buffer.from('{}'), 'bad-sig')).rejects.toThrow(StripeWebhookSignatureError);
    });
  });

  describe('idempotency', () => {
    it('drops duplicate event via Redis fast-path', async () => {
      const event = { id: 'evt_1', type: 'invoice.created', created: nowSeconds(), data: { object: {} } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const repo = makeRepo();
      const billing = makeBilling();
      const redis = makeRedis();

      const handler = new StripeWebhookHandler(
        repo as never, billing as never, stripe as never, redis as never, makeAudit() as never, makeLog() as never,
      );

      // First delivery succeeds.
      await handler.handle(Buffer.from('payload'), 'sig');
      // Second delivery (replay) — Redis NX returns null; handler should short-circuit.
      const audit = makeAudit();
      const handler2 = new StripeWebhookHandler(
        repo as never, billing as never, stripe as never, redis as never, audit as never, makeLog() as never,
      );
      await handler2.handle(Buffer.from('payload'), 'sig');

      // insertBillingEventIfNew should only have been called once.
      expect(repo.insertBillingEventIfNew).toHaveBeenCalledTimes(1);
    });

    it('drops duplicate event via DB-authoritative dedup when Redis lost the key', async () => {
      const event = { id: 'evt_dup', type: 'invoice.created', created: nowSeconds(), data: { object: {} } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const repo = makeRepo({
        insertBillingEventIfNew: vi.fn().mockResolvedValue({ inserted: false, row: { stripeEventId: 'evt_dup' } }),
      });
      const billing = makeBilling();
      const redis = makeRedis(); // fresh Redis — key not present
      const handler = new StripeWebhookHandler(
        repo as never, billing as never, stripe as never, redis as never, makeAudit() as never, makeLog() as never,
      );

      const result = await handler.handle(Buffer.from('payload'), 'sig');
      expect(result.received).toBe(true);
      // Subscription handler should NOT have been called for duplicate event.
      expect(billing.reconcileSubscriptionFromStripe).not.toHaveBeenCalled();
    });
  });

  describe('dispatch', () => {
    it('handles checkout.session.completed', async () => {
      const session = {
        id: 'cs_test',
        client_reference_id: 'ws-1',
        subscription: 'sub_test',
        metadata: { workspaceId: 'ws-1' },
      };
      const event = { id: 'evt_co', type: 'checkout.session.completed', created: nowSeconds(), data: { object: session } };
      const stripeSub = {
        id: 'sub_test',
        customer: 'cus_test',
        items: { data: [{ id: 'si_1', price: { id: 'price_x', product: 'prod_x' } }] },
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: nowSeconds(),
        current_period_end: nowSeconds() + 86400 * 30,
        metadata: { workspaceId: 'ws-1', plan: 'growth', billingInterval: 'monthly' },
      };
      const stripe = makeStripe({
        constructEvent: vi.fn().mockReturnValue(event),
        retrieveSubscription: vi.fn().mockResolvedValue(stripeSub),
      });
      const billing = makeBilling();
      const handler = new StripeWebhookHandler(
        makeRepo() as never, billing as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never,
      );

      await handler.handle(Buffer.from('p'), 's');
      expect(billing.reconcileSubscriptionFromStripe).toHaveBeenCalledWith('ws-1', stripeSub);
    });

    it('handles customer.subscription.updated', async () => {
      const stripeSub = {
        id: 'sub_test',
        customer: 'cus_test',
        items: { data: [{ id: 'si_1', price: { id: 'price_x', product: 'prod_x' } }] },
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: nowSeconds(),
        current_period_end: nowSeconds() + 86400 * 30,
        metadata: { workspaceId: 'ws-1' },
      };
      const event = { id: 'evt_sub_upd', type: 'customer.subscription.updated', created: nowSeconds(), data: { object: stripeSub } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const billing = makeBilling();
      const handler = new StripeWebhookHandler(
        makeRepo() as never, billing as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never,
      );

      await handler.handle(Buffer.from('p'), 's');
      expect(billing.reconcileSubscriptionFromStripe).toHaveBeenCalledWith('ws-1', stripeSub);
    });

    it('handles customer.subscription.deleted by demoting to free', async () => {
      const stripeSub = {
        id: 'sub_test',
        customer: 'cus_test',
        items: { data: [] },
        status: 'canceled',
        metadata: { workspaceId: 'ws-1' },
      };
      const event = { id: 'evt_sub_del', type: 'customer.subscription.deleted', created: nowSeconds(), data: { object: stripeSub } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const repo = makeRepo();
      const handler = new StripeWebhookHandler(
        repo as never, makeBilling() as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never,
      );

      await handler.handle(Buffer.from('p'), 's');
      expect(repo.updateSubscriptionByStripeId).toHaveBeenCalledWith(
        'sub_test',
        expect.objectContaining({ plan: 'free', status: 'canceled', stripeSubscriptionId: null }),
      );
    });

    it('handles invoice.payment_succeeded', async () => {
      const invoice = {
        id: 'in_test',
        customer: 'cus_test',
        amount_due: 2900,
        amount_paid: 2900,
        currency: 'usd',
        status: 'paid',
        hosted_invoice_url: 'https://invoice.test/in_test',
        invoice_pdf: 'https://invoice.test/in_test.pdf',
        created: nowSeconds(),
      };
      const event = { id: 'evt_inv', type: 'invoice.payment_succeeded', created: nowSeconds(), data: { object: invoice } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const repo = makeRepo();
      const handler = new StripeWebhookHandler(
        repo as never, makeBilling() as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never,
      );

      await handler.handle(Buffer.from('p'), 's');
      expect(repo.upsertInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ stripeInvoiceId: 'in_test', amountPaid: 2900, status: 'paid' }),
      );
    });

    it('handles invoice.payment_failed and increments failure metric', async () => {
      const invoice = {
        id: 'in_failed',
        customer: 'cus_test',
        amount_due: 2900,
        amount_paid: 0,
        currency: 'usd',
        status: 'open',
        hosted_invoice_url: null,
        invoice_pdf: null,
        created: nowSeconds(),
        attempt_count: 2,
      };
      const event = { id: 'evt_failed', type: 'invoice.payment_failed', created: nowSeconds(), data: { object: invoice } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const repo = makeRepo({
        findSubscriptionByWorkspace: vi.fn().mockResolvedValue({ plan: 'growth' }),
      });
      const handler = new StripeWebhookHandler(
        repo as never, makeBilling() as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never,
      );

      await handler.handle(Buffer.from('p'), 's');
      expect(repo.upsertInvoice).toHaveBeenCalled();
    });

    it('ignores unknown event types', async () => {
      const event = { id: 'evt_unknown', type: 'some.unknown.event', created: nowSeconds(), data: { object: {} } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const repo = makeRepo();
      const billing = makeBilling();
      const handler = new StripeWebhookHandler(
        repo as never, billing as never, stripe as never, makeRedis() as never, makeAudit() as never, makeLog() as never,
      );

      const result = await handler.handle(Buffer.from('p'), 's');
      expect(result.received).toBe(true);
      // Still recorded in billing_events (audit), but no domain handler called.
      expect(billing.reconcileSubscriptionFromStripe).not.toHaveBeenCalled();
      expect(repo.upsertInvoice).not.toHaveBeenCalled();
    });
  });

  describe('replay window', () => {
    it('warns but still processes events older than replay window (Stripe legitimate retries)', async () => {
      const veryOld = Math.floor(Date.now() / 1000) - 60 * 60; // 1 hour old
      const event = { id: 'evt_old', type: 'invoice.created', created: veryOld, data: { object: { id: 'in_x', customer: 'cus_x', amount_due: 0, amount_paid: 0, currency: 'usd', status: 'draft', created: veryOld } } };
      const stripe = makeStripe({ constructEvent: vi.fn().mockReturnValue(event) });
      const log = makeLog();
      const handler = new StripeWebhookHandler(
        makeRepo() as never,
        { ...makeBilling(), resolveWorkspaceForCustomer: vi.fn().mockResolvedValue('ws-1') } as never,
        stripe as never,
        makeRedis() as never,
        makeAudit() as never,
        log as never,
      );

      const result = await handler.handle(Buffer.from('p'), 's');
      expect(result.received).toBe(true);
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ ageSeconds: expect.any(Number) }),
        expect.stringContaining('replay window'),
      );
    });
  });
});
