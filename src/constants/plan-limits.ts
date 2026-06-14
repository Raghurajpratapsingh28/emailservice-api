/**
 * Workspace plan limits. Used by:
 *   - workspace-plan middleware (legacy member/contact/campaign checks)
 *   - billing module (metric-based quota enforcement: contacts, emails, events)
 *
 * Plan tiers are aligned with Stripe products. The tier is stored on
 * `workspaces.plan` and on `subscriptions.plan` (kept in sync by the webhook
 * handler on subscription state changes).
 */

export const BILLING_PLANS = ['free', 'starter', 'growth', 'pro', 'scale'] as const;
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
    contacts: 1_000,
    emails: 3_000,
    events: 5_000,
  },
  starter: {
    contacts: 10_000,
    emails: 25_000,
    events: 100_000,
  },
  growth: {
    contacts: 50_000,
    emails: 150_000,
    events: 500_000,
  },
  pro: {
    contacts: 150_000,
    emails: 500_000,
    events: 2_000_000,
  },
  scale: {
    contacts: 500_000,
    emails: 2_000_000,
    events: 10_000_000,
  },
} as const;

/**
 * Legacy workspace plan limits (members, monthly campaigns) — kept for backward
 * compatibility with the workspace-plan middleware. Aligned to BillingPlan tiers.
 */
export const PLAN_LIMITS = {
  free: {
    maxMembers: 1,
    maxContacts: PLAN_QUOTAS.free.contacts,
    maxCampaignsPerMonth: 5,
  },
  starter: {
    maxMembers: 5,
    maxContacts: PLAN_QUOTAS.starter.contacts,
    maxCampaignsPerMonth: 50,
  },
  growth: {
    maxMembers: 15,
    maxContacts: PLAN_QUOTAS.growth.contacts,
    maxCampaignsPerMonth: 200,
  },
  pro: {
    maxMembers: 50,
    maxContacts: PLAN_QUOTAS.pro.contacts,
    maxCampaignsPerMonth: 500,
  },
  scale: {
    maxMembers: 200,
    maxContacts: PLAN_QUOTAS.scale.contacts,
    maxCampaignsPerMonth: 2_000,
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
    maxApiKeys: 1,
    maxEmailTemplates: 5,
    maxWebhooks: 0,
    hasApiAccess: false,
    hasCustomDomains: true,
    hasAdvancedAnalytics: false,
    removeBranding: false,
  },
  starter: {
    maxDomains: 3,
    maxSegments: 20,
    maxWorkflows: 10,
    maxApiKeys: 5,
    maxEmailTemplates: 30,
    maxWebhooks: 0,
    hasApiAccess: false,
    hasCustomDomains: true,
    hasAdvancedAnalytics: false,
    removeBranding: true,
  },
  growth: {
    maxDomains: 10,
    maxSegments: 100,
    maxWorkflows: 50,
    maxApiKeys: 20,
    maxEmailTemplates: 200,
    maxWebhooks: 10,
    hasApiAccess: true,
    hasCustomDomains: true,
    hasAdvancedAnalytics: true,
    removeBranding: true,
  },
  pro: {
    maxDomains: 50,
    maxSegments: 500,
    maxWorkflows: 200,
    maxApiKeys: 50,
    maxEmailTemplates: 1_000,
    maxWebhooks: 50,
    hasApiAccess: true,
    hasCustomDomains: true,
    hasAdvancedAnalytics: true,
    removeBranding: true,
  },
  scale: {
    maxDomains: Number.POSITIVE_INFINITY,
    maxSegments: Number.POSITIVE_INFINITY,
    maxWorkflows: Number.POSITIVE_INFINITY,
    maxApiKeys: Number.POSITIVE_INFINITY,
    maxEmailTemplates: Number.POSITIVE_INFINITY,
    maxWebhooks: Number.POSITIVE_INFINITY,
    hasApiAccess: true,
    hasCustomDomains: true,
    hasAdvancedAnalytics: true,
    removeBranding: true,
  },
  enterprise: {
    maxDomains: Number.POSITIVE_INFINITY,
    maxSegments: Number.POSITIVE_INFINITY,
    maxWorkflows: Number.POSITIVE_INFINITY,
    maxApiKeys: Number.POSITIVE_INFINITY,
    maxEmailTemplates: Number.POSITIVE_INFINITY,
    maxWebhooks: Number.POSITIVE_INFINITY,
    hasApiAccess: true,
    hasCustomDomains: true,
    hasAdvancedAnalytics: true,
    removeBranding: true,
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
  scale: 4,
  enterprise: 5,
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
