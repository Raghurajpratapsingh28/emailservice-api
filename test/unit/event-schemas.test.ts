import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  aliasBodySchema,
  groupBodySchema,
  identifyBodySchema,
  pageBodySchema,
  trackBodySchema,
} from '@modules/events/schemas/event.schema.js';

describe('event Zod schemas', () => {
  describe('trackBodySchema', () => {
    it('accepts valid track with userId', () => {
      const out = trackBodySchema.parse({
        userId: 'u1',
        event: 'Trial Upgraded',
        properties: { plan: 'pro' },
      });
      expect(out.event).toBe('Trial Upgraded');
    });

    it('accepts valid track with anonymousId only', () => {
      const out = trackBodySchema.parse({ anonymousId: 'anon', event: 'Clicked' });
      expect(out.anonymousId).toBe('anon');
    });

    it('rejects when neither userId nor anonymousId', () => {
      expect(() => trackBodySchema.parse({ event: 'X' })).toThrow(ZodError);
    });

    it('rejects missing event', () => {
      expect(() => trackBodySchema.parse({ userId: 'u1' })).toThrow(ZodError);
    });

    it('coerces timestamp string to Date', () => {
      const out = trackBodySchema.parse({
        userId: 'u1',
        event: 'X',
        timestamp: '2026-05-25T12:00:00Z',
      });
      expect(out.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('identifyBodySchema', () => {
    it('accepts userId + traits', () => {
      const out = identifyBodySchema.parse({
        userId: 'u1',
        traits: { email: 'a@b.com' },
      });
      expect(out.traits?.email).toBe('a@b.com');
    });

    it('rejects no identity', () => {
      expect(() => identifyBodySchema.parse({ traits: {} })).toThrow(ZodError);
    });
  });

  describe('pageBodySchema', () => {
    it('accepts page with name', () => {
      const out = pageBodySchema.parse({ userId: 'u1', name: 'Pricing' });
      expect(out.name).toBe('Pricing');
    });

    it('accepts page without name', () => {
      const out = pageBodySchema.parse({ anonymousId: 'a' });
      expect(out.name).toBeUndefined();
    });
  });

  describe('groupBodySchema', () => {
    it('requires groupId', () => {
      expect(() => groupBodySchema.parse({ userId: 'u1' })).toThrow(ZodError);
    });

    it('accepts valid group', () => {
      const out = groupBodySchema.parse({ userId: 'u1', groupId: 'g1', traits: { name: 'Acme' } });
      expect(out.groupId).toBe('g1');
    });
  });

  describe('aliasBodySchema', () => {
    it('requires both previousId and userId', () => {
      expect(() => aliasBodySchema.parse({ previousId: 'anon' })).toThrow(ZodError);
      expect(() => aliasBodySchema.parse({ userId: 'u1' })).toThrow(ZodError);
    });

    it('accepts valid alias', () => {
      const out = aliasBodySchema.parse({ previousId: 'anon', userId: 'u1' });
      expect(out.previousId).toBe('anon');
      expect(out.userId).toBe('u1');
    });
  });
});
