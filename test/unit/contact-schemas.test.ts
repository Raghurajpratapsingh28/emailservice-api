import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  bulkImportBodySchema,
  createContactBodySchema,
  listContactsQuerySchema,
  updateContactBodySchema,
} from '@modules/contacts/schemas/contact.schema.js';

describe('contact Zod schemas', () => {
  describe('createContactBodySchema', () => {
    it('accepts valid contact with email', () => {
      const out = createContactBodySchema.parse({
        email: 'Alice@Example.com',
        firstName: 'Alice',
        lifecycleStage: 'lead',
        tags: ['trial'],
        properties: { plan: 'free' },
      });
      expect(out.email).toBe('Alice@Example.com');
    });

    it('accepts contact with anonymousId only', () => {
      const out = createContactBodySchema.parse({ anonymousId: 'anon-123' });
      expect(out.anonymousId).toBe('anon-123');
    });

    it('rejects when no identifier provided', () => {
      expect(() => createContactBodySchema.parse({ firstName: 'Alice' })).toThrow(ZodError);
    });

    it('rejects invalid email', () => {
      expect(() => createContactBodySchema.parse({ email: 'not-an-email' })).toThrow(ZodError);
    });

    it('rejects invalid lifecycleStage', () => {
      expect(() =>
        createContactBodySchema.parse({ email: 'a@b.com', lifecycleStage: 'invalid' }),
      ).toThrow(ZodError);
    });

    it('rejects leadScore out of range', () => {
      expect(() =>
        createContactBodySchema.parse({ email: 'a@b.com', leadScore: 200 }),
      ).toThrow(ZodError);
    });

    it('rejects too many tags', () => {
      const tags = Array.from({ length: 51 }, (_, i) => `tag${i}`);
      expect(() => createContactBodySchema.parse({ email: 'a@b.com', tags })).toThrow(ZodError);
    });
  });

  describe('updateContactBodySchema', () => {
    it('accepts partial update', () => {
      const out = updateContactBodySchema.parse({ firstName: 'Bob', leadScore: 50 });
      expect(out.firstName).toBe('Bob');
      expect(out.leadScore).toBe(50);
    });

    it('accepts suppression flags', () => {
      const out = updateContactBodySchema.parse({ emailSuppressed: true, unsubscribed: true });
      expect(out.emailSuppressed).toBe(true);
    });

    it('accepts empty object', () => {
      expect(() => updateContactBodySchema.parse({})).not.toThrow();
    });
  });

  describe('listContactsQuerySchema', () => {
    it('applies defaults', () => {
      const out = listContactsQuerySchema.parse({});
      expect(out.page).toBe(1);
      expect(out.pageSize).toBe(50);
    });

    it('parses comma-separated tags', () => {
      const out = listContactsQuerySchema.parse({ tags: 'trial,saas' });
      expect(out.tags).toEqual(['trial', 'saas']);
    });

    it('rejects pageSize > 200', () => {
      expect(() => listContactsQuerySchema.parse({ pageSize: '500' })).toThrow(ZodError);
    });
  });

  describe('bulkImportBodySchema', () => {
    it('accepts array of valid contacts', () => {
      const out = bulkImportBodySchema.parse({
        contacts: [{ email: 'a@b.com' }, { anonymousId: 'anon' }],
      });
      expect(out.contacts).toHaveLength(2);
    });

    it('rejects empty array', () => {
      expect(() => bulkImportBodySchema.parse({ contacts: [] })).toThrow(ZodError);
    });

    it('rejects array exceeding 1000', () => {
      const contacts = Array.from({ length: 1001 }, (_, i) => ({ email: `u${i}@b.com` }));
      expect(() => bulkImportBodySchema.parse({ contacts })).toThrow(ZodError);
    });
  });
});
