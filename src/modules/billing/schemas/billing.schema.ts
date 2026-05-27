import { z } from 'zod';
import { BILLING_INTERVALS, BILLING_PLANS } from '@constants/plan-limits.js';

/** Plans available for purchase via Checkout. `free` is excluded. */
const PURCHASABLE_PLANS = BILLING_PLANS.filter((p) => p !== 'free') as ['starter', 'growth', 'pro'];

export const createCheckoutBodySchema = z.object({
  plan: z.enum(PURCHASABLE_PLANS),
  billingInterval: z.enum(BILLING_INTERVALS),
});

export const changePlanBodySchema = z.object({
  plan: z.enum(PURCHASABLE_PLANS),
  billingInterval: z.enum(BILLING_INTERVALS),
});

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateCheckoutBody = z.infer<typeof createCheckoutBodySchema>;
export type ChangePlanBody = z.infer<typeof changePlanBodySchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
