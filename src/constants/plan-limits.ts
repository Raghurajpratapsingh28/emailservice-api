/**
 * Workspace plan limits. Used by:
 *   - workspace-plan middleware (legacy member/contact/campaign checks)
 *   - billing module (metric-based quota enforcement: contacts, emails, events)
 *
 * Plan tiers are aligned with Stripe products. The tier is stored on
 * `workspaces.plan` and on `subscriptions.plan` (kept in sync by the webhook
 * handler on subscription state changes).
 */

export const BILLING_PLANS = ['free', 'starter', 'growth', 'pro'] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const BILLING_INTERVALS = ['monthly', 'yearly'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const QUOTA_METRICS = ['contacts', 'emails', 'events'] as const;
export type QuotaMetric = (typeof QUOTA_METRICS)[number];

/**
 * Quota limits per plan. `Number.POSITIVE_INFINITY` = unlimited.
 * For `pro` we expose generous defaults and let sales contracts override at the workspace level.
 */
export const PLAN_QUOTAS: Record<BillingPlan, Record<QuotaMetric, number>> = {
  free: {
    contacts: 100,
    emails: 500,
    events: 1_000,
  },
  starter: {
    contacts: 5_000,
    emails: 20_000,
    events: 50_000,
  },
  growth: {
    contacts: 50_000,
    emails: 200_000,
    events: 500_000,
  },
  pro: {
    contacts: 500_000,
    emails: 2_000_000,
    events: 5_000_000,
  },
} as const;

/**
 * Legacy workspace plan limits (members, monthly campaigns) — kept for backward
 * compatibility with the workspace-plan middleware. Aligned to BillingPlan tiers.
 */
export const PLAN_LIMITS = {
  free: {
    maxMembers: 3,
    maxContacts: PLAN_QUOTAS.free.contacts,
    maxCampaignsPerMonth: 5,
  },
  starter: {
    maxMembers: 10,
    maxContacts: PLAN_QUOTAS.starter.contacts,
    maxCampaignsPerMonth: 50,
  },
  growth: {
    maxMembers: 25,
    maxContacts: PLAN_QUOTAS.growth.contacts,
    maxCampaignsPerMonth: 200,
  },
  pro: {
    maxMembers: 100,
    maxContacts: PLAN_QUOTAS.pro.contacts,
    maxCampaignsPerMonth: 1_000,
  },
  enterprise: {
    maxMembers: Number.POSITIVE_INFINITY,
    maxContacts: Number.POSITIVE_INFINITY,
    maxCampaignsPerMonth: Number.POSITIVE_INFINITY,
  },
} as const;

export type PlanTier = keyof typeof PLAN_LIMITS;

export const RESOURCE_LIMITS = {
  free: {
    maxDomains: 1,
    maxSegments: 3,
    maxWorkflows: 1,
    maxApiKeys: 2,
    maxEmailTemplates: 5,
  },
  starter: {
    maxDomains: 3,
    maxSegments: 20,
    maxWorkflows: 5,
    maxApiKeys: 5,
    maxEmailTemplates: 20,
  },
  growth: {
    maxDomains: 10,
    maxSegments: 100,
    maxWorkflows: 20,
    maxApiKeys: 20,
    maxEmailTemplates: 100,
  },
  pro: {
    maxDomains: Number.POSITIVE_INFINITY,
    maxSegments: Number.POSITIVE_INFINITY,
    maxWorkflows: Number.POSITIVE_INFINITY,
    maxApiKeys: Number.POSITIVE_INFINITY,
    maxEmailTemplates: Number.POSITIVE_INFINITY,
  },
  enterprise: {
    maxDomains: Number.POSITIVE_INFINITY,
    maxSegments: Number.POSITIVE_INFINITY,
    maxWorkflows: Number.POSITIVE_INFINITY,
    maxApiKeys: Number.POSITIVE_INFINITY,
    maxEmailTemplates: Number.POSITIVE_INFINITY,
  },
} as const;

export type ResourceLimitKey = keyof typeof RESOURCE_LIMITS['free'];

export type ResourceLimits = typeof RESOURCE_LIMITS[keyof typeof RESOURCE_LIMITS];

export function resourceLimitsForPlan(plan: string): ResourceLimits {
  if (plan in RESOURCE_LIMITS) {
    return RESOURCE_LIMITS[plan as keyof typeof RESOURCE_LIMITS];
  }
  return RESOURCE_LIMITS.free;
}
export const ALL_PLAN_TIERS: readonly PlanTier[] = Object.keys(PLAN_LIMITS) as PlanTier[];

/**
 * Plan rank for upgrade/downgrade detection.
 * Higher = more privileged. `enterprise` is reserved for sales-managed accounts.
 */
export const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  starter: 1,
  growth: 2,
  pro: 3,
  enterprise: 4,
};

/** Resolve quotas for a plan; falls back to free if unknown. */
export function quotasForPlan(plan: string): Record<QuotaMetric, number> {
  if ((BILLING_PLANS as readonly string[]).includes(plan)) {
    return PLAN_QUOTAS[plan as BillingPlan];
  }
  // enterprise is not in BILLING_PLANS (sales-managed, not purchasable via Stripe)
  // but must get unlimited quotas, not the free-tier fallback.
  if (plan === 'enterprise') {
    return { contacts: Number.POSITIVE_INFINITY, emails: Number.POSITIVE_INFINITY, events: Number.POSITIVE_INFINITY };
  }
  return PLAN_QUOTAS.free;
}
