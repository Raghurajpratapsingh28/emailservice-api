import Stripe from 'stripe';
import { config } from '@config/index.js';
import type { BillingInterval, BillingPlan } from '@constants/plan-limits.js';
import { AppError } from '@shared/errors/app-errors.js';

/**
 * Thin wrapper over the official Stripe SDK.
 *
 * Responsibilities:
 *   - Lazy client construction (Stripe key may be absent in dev/test).
 *   - Centralised price-id lookup keyed on (plan, interval).
 *   - Raw-body webhook signature verification.
 *
 * The wrapper is the only module that imports `stripe` directly; everything
 * else depends on this interface so we can mock it in tests.
 */

export interface StripeClient {
  /** Underlying Stripe SDK instance — escape hatch for advanced ops. */
  readonly raw: Stripe;
  resolvePriceId(plan: BillingPlan, interval: BillingInterval): string;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<Stripe.Checkout.Session>;
  createBillingPortalSession(params: CreatePortalSessionParams): Promise<Stripe.BillingPortal.Session>;
  createCustomer(params: CreateCustomerParams): Promise<Stripe.Customer>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  updateSubscription(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
  cancelSubscription(id: string, atPeriodEnd: boolean): Promise<Stripe.Subscription>;
  resumeSubscription(id: string): Promise<Stripe.Subscription>;
  /** Verify and parse a Stripe webhook payload. Throws on invalid signature. */
  constructEvent(rawBody: string | Buffer, signature: string): Stripe.Event;
}

export interface CreateCheckoutSessionParams {
  workspaceId: string;
  customerId?: string;
  customerEmail?: string;
  priceId: string;
  plan: BillingPlan;
  billingInterval: BillingInterval;
  successUrl?: string;
  cancelUrl?: string;
  /** Stripe idempotency key — protects against duplicate sessions on retry. */
  idempotencyKey?: string;
}

export interface CreatePortalSessionParams {
  customerId: string;
  returnUrl?: string;
}

export interface CreateCustomerParams {
  workspaceId: string;
  email?: string;
  name?: string;
}

const PRICE_ID_MAP: Record<BillingPlan, Record<BillingInterval, string | undefined>> = {
  free: { monthly: undefined, yearly: undefined },
  starter: {
    monthly: config.STRIPE_STARTER_MONTHLY_PRICE_ID,
    yearly: config.STRIPE_STARTER_YEARLY_PRICE_ID,
  },
  growth: {
    monthly: config.STRIPE_GROWTH_MONTHLY_PRICE_ID,
    yearly: config.STRIPE_GROWTH_YEARLY_PRICE_ID,
  },
  pro: {
    monthly: config.STRIPE_PRO_MONTHLY_PRICE_ID,
    yearly: config.STRIPE_PRO_YEARLY_PRICE_ID,
  },
  scale: {
    monthly: config.STRIPE_SCALE_MONTHLY_PRICE_ID,
    yearly: config.STRIPE_SCALE_YEARLY_PRICE_ID,
  },
};

export class StripeNotConfiguredError extends AppError {
  public constructor() {
    super('Stripe is not configured', { code: 'STRIPE_NOT_CONFIGURED', statusCode: 500, expose: false });
  }
}

export class StripeWebhookSignatureError extends AppError {
  public constructor(message = 'Invalid webhook signature') {
    super(message, { code: 'WEBHOOK_SIGNATURE_INVALID', statusCode: 400 });
  }
}

export function createStripeClient(opts?: {
  secretKey?: string;
  webhookSecret?: string;
}): StripeClient {
  const secretKey = opts?.secretKey ?? config.STRIPE_SECRET_KEY;
  const webhookSecret = opts?.webhookSecret ?? config.STRIPE_WEBHOOK_SECRET;

  if (!secretKey) {
    throw new StripeNotConfiguredError();
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: config.STRIPE_API_VERSION as Stripe.LatestApiVersion,
    typescript: true,
    appInfo: {
      name: 'engageiq-api',
      version: config.APP_VERSION,
    },
    maxNetworkRetries: 2,
    timeout: 20_000,
  });

  return {
    raw: stripe,

    resolvePriceId(plan, interval) {
      const id = PRICE_ID_MAP[plan]?.[interval];
      if (!id) {
        throw new AppError(`Stripe price id not configured for ${plan}/${interval}`, {
          code: 'INVALID_PLAN',
          statusCode: 400,
        });
      }
      return id;
    },

    async createCheckoutSession(params) {
      const successUrl = params.successUrl ?? config.STRIPE_CHECKOUT_SUCCESS_URL;
      const cancelUrl = params.cancelUrl ?? config.STRIPE_CHECKOUT_CANCEL_URL;
      if (!successUrl || !cancelUrl) {
        throw new AppError('Stripe checkout URLs not configured', {
          code: 'STRIPE_NOT_CONFIGURED',
          statusCode: 500,
          expose: false,
        });
      }
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        line_items: [{ price: params.priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: params.workspaceId,
        metadata: {
          workspaceId: params.workspaceId,
          plan: params.plan,
          billingInterval: params.billingInterval,
          environment: config.NODE_ENV,
        },
        subscription_data: {
          metadata: {
            workspaceId: params.workspaceId,
            plan: params.plan,
            billingInterval: params.billingInterval,
          },
        },
        allow_promotion_codes: true,
      };
      if (params.customerId) {
        sessionParams.customer = params.customerId;
      } else if (params.customerEmail) {
        sessionParams.customer_email = params.customerEmail;
      }

      return stripe.checkout.sessions.create(
        sessionParams,
        params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
      );
    },

    async createBillingPortalSession(params) {
      const returnUrl = params.returnUrl ?? config.STRIPE_PORTAL_RETURN_URL;
      if (!returnUrl) {
        throw new AppError('Stripe portal return URL not configured', {
          code: 'STRIPE_NOT_CONFIGURED',
          statusCode: 500,
          expose: false,
        });
      }
      return stripe.billingPortal.sessions.create({
        customer: params.customerId,
        return_url: returnUrl,
      });
    },

    async createCustomer(params) {
      return stripe.customers.create({
        email: params.email,
        name: params.name,
        metadata: {
          workspaceId: params.workspaceId,
          environment: config.NODE_ENV,
        },
      });
    },

    async retrieveSubscription(id) {
      return stripe.subscriptions.retrieve(id);
    },

    async updateSubscription(id, params) {
      return stripe.subscriptions.update(id, params);
    },

    async cancelSubscription(id, atPeriodEnd) {
      if (atPeriodEnd) {
        return stripe.subscriptions.update(id, { cancel_at_period_end: true });
      }
      return stripe.subscriptions.cancel(id);
    },

    async resumeSubscription(id) {
      return stripe.subscriptions.update(id, { cancel_at_period_end: false });
    },

    constructEvent(rawBody, signature) {
      if (!webhookSecret) {
        throw new AppError('Stripe webhook secret not configured', {
          code: 'STRIPE_NOT_CONFIGURED',
          statusCode: 500,
          expose: false,
        });
      }
      try {
        return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (err) {
        throw new StripeWebhookSignatureError((err as Error).message);
      }
    },
  };
}

export type { Stripe };

/**
 * Stub Stripe client for environments where Stripe is not configured (most
 * tests, dev without keys). Every operation throws STRIPE_NOT_CONFIGURED so
 * billing endpoints fail fast without leaking unhandled errors.
 */
export function createStripeStub(): StripeClient {
  const fail = (): never => {
    throw new StripeNotConfiguredError();
  };
  return {
    raw: new Proxy({}, { get: fail }) as Stripe,
    resolvePriceId: fail,
    createCheckoutSession: fail,
    createBillingPortalSession: fail,
    createCustomer: fail,
    retrieveSubscription: fail,
    updateSubscription: fail,
    cancelSubscription: fail,
    resumeSubscription: fail,
    constructEvent: fail,
  };
}
