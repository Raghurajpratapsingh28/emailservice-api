import { Counter, Gauge } from 'prom-client';

export const billingCheckoutSessions = new Counter({
  name: 'billing_checkout_sessions_total',
  help: 'Total billing checkout sessions created',
  labelNames: ['plan', 'interval'] as const,
});

export const billingWebhookEvents = new Counter({
  name: 'billing_webhook_events_total',
  help: 'Total Stripe webhook events received',
  labelNames: ['event_type', 'outcome'] as const, // outcome: processed | duplicate | invalid_signature | failed
});

export const billingWebhookFailures = new Counter({
  name: 'billing_webhook_failures_total',
  help: 'Total Stripe webhook handler failures (after signature verification)',
  labelNames: ['event_type'] as const,
});

export const billingPaymentFailures = new Counter({
  name: 'billing_payment_failures_total',
  help: 'Total invoice payment failures',
  labelNames: ['plan'] as const,
});

export const billingPlanUpgrades = new Counter({
  name: 'billing_plan_upgrades_total',
  help: 'Total plan upgrades',
  labelNames: ['from_plan', 'to_plan'] as const,
});

export const billingPlanDowngrades = new Counter({
  name: 'billing_plan_downgrades_total',
  help: 'Total plan downgrades',
  labelNames: ['from_plan', 'to_plan'] as const,
});

export const billingActiveSubscriptions = new Gauge({
  name: 'billing_active_subscriptions',
  help: 'Active subscriptions by plan',
  labelNames: ['plan'] as const,
});
