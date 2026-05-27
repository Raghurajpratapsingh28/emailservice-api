import { describe, expect, it } from 'vitest';
import {
  BILLING_INTERVALS,
  BILLING_PLANS,
  PLAN_QUOTAS,
  PLAN_RANK,
  QUOTA_METRICS,
  quotasForPlan,
} from '@constants/plan-limits.js';

describe('plan-limits', () => {
  it('defines all four billing plans', () => {
    expect(BILLING_PLANS).toEqual(['free', 'starter', 'growth', 'pro']);
  });

  it('defines monthly and yearly intervals', () => {
    expect(BILLING_INTERVALS).toEqual(['monthly', 'yearly']);
  });

  it('defines three quota metrics', () => {
    expect(QUOTA_METRICS).toEqual(['contacts', 'emails', 'events']);
  });

  it('PLAN_QUOTAS has all metrics for every plan', () => {
    for (const plan of BILLING_PLANS) {
      for (const metric of QUOTA_METRICS) {
        expect(PLAN_QUOTAS[plan][metric]).toBeGreaterThan(0);
      }
    }
  });

  it('quotas increase monotonically with plan rank', () => {
    expect(PLAN_QUOTAS.starter.contacts).toBeGreaterThan(PLAN_QUOTAS.free.contacts);
    expect(PLAN_QUOTAS.growth.contacts).toBeGreaterThan(PLAN_QUOTAS.starter.contacts);
    expect(PLAN_QUOTAS.pro.contacts).toBeGreaterThan(PLAN_QUOTAS.growth.contacts);
  });

  it('PLAN_RANK orders plans correctly', () => {
    expect(PLAN_RANK.free).toBeLessThan(PLAN_RANK.starter);
    expect(PLAN_RANK.starter).toBeLessThan(PLAN_RANK.growth);
    expect(PLAN_RANK.growth).toBeLessThan(PLAN_RANK.pro);
  });

  it('quotasForPlan falls back to free for unknown plans', () => {
    expect(quotasForPlan('unknown')).toEqual(PLAN_QUOTAS.free);
  });

  it('quotasForPlan returns the correct quotas for known plans', () => {
    expect(quotasForPlan('growth')).toEqual(PLAN_QUOTAS.growth);
  });
});
