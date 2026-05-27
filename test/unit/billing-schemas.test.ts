import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  changePlanBodySchema,
  createCheckoutBodySchema,
  listInvoicesQuerySchema,
} from '@modules/billing/schemas/billing.schema.js';

describe('billing Zod schemas', () => {
  describe('createCheckoutBodySchema', () => {
    it('accepts a valid purchasable plan + interval', () => {
      const out = createCheckoutBodySchema.parse({ plan: 'growth', billingInterval: 'monthly' });
      expect(out.plan).toBe('growth');
      expect(out.billingInterval).toBe('monthly');
    });

    it('rejects free plan (not purchasable)', () => {
      expect(() =>
        createCheckoutBodySchema.parse({ plan: 'free', billingInterval: 'monthly' }),
      ).toThrow(ZodError);
    });

    it('rejects unknown plan', () => {
      expect(() =>
        createCheckoutBodySchema.parse({ plan: 'unicorn', billingInterval: 'monthly' }),
      ).toThrow(ZodError);
    });

    it('rejects unknown billing interval', () => {
      expect(() =>
        createCheckoutBodySchema.parse({ plan: 'growth', billingInterval: 'weekly' }),
      ).toThrow(ZodError);
    });

    it('rejects missing fields', () => {
      expect(() => createCheckoutBodySchema.parse({})).toThrow(ZodError);
      expect(() => createCheckoutBodySchema.parse({ plan: 'growth' })).toThrow(ZodError);
    });
  });

  describe('changePlanBodySchema', () => {
    it('accepts a purchasable plan', () => {
      const out = changePlanBodySchema.parse({ plan: 'pro', billingInterval: 'yearly' });
      expect(out.plan).toBe('pro');
    });

    it('rejects free plan', () => {
      expect(() => changePlanBodySchema.parse({ plan: 'free', billingInterval: 'monthly' })).toThrow(ZodError);
    });
  });

  describe('listInvoicesQuerySchema', () => {
    it('applies defaults', () => {
      const out = listInvoicesQuerySchema.parse({});
      expect(out.page).toBe(1);
      expect(out.pageSize).toBe(20);
    });

    it('rejects pageSize > 100', () => {
      expect(() => listInvoicesQuerySchema.parse({ pageSize: '200' })).toThrow(ZodError);
    });

    it('rejects negative page', () => {
      expect(() => listInvoicesQuerySchema.parse({ page: '0' })).toThrow(ZodError);
    });
  });
});
