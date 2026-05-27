import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  domainSchema,
  isValidDomainShape,
  createDomainBodySchema,
} from '@modules/domains/schemas/domain.schema.js';

describe('domain validator', () => {
  describe('isValidDomainShape', () => {
    it.each([
      ['acme.com'],
      ['mail.acme.com'],
      ['a-b.example.org'],
      ['x.io'],
      ['xn--bcher-kva.com'],
      ['9to5.dev'],
    ])('accepts valid: %s', (d) => {
      expect(isValidDomainShape(d)).toEqual({ ok: true });
    });

    it.each([
      ['', 'required'],
      ['localhost', 'reserved'],
      ['local', 'reserved'],
      ['10.0.0.1', 'IP'],
      ['::1', 'IP'],
      ['no-dot', 'dot'],
      ['-leadinghyphen.com', 'hyphen'],
      ['trailinghyphen-.com', 'hyphen'],
      ['under_score.com', 'a-z'],
      ['acme.localhost', 'Reserved TLD'],
      ['acme.test', 'Reserved TLD'],
      ['acme.example', 'Reserved TLD'],
      ['acme.invalid', 'Reserved TLD'],
      ['x.x', 'TLD must be at least 2'],
      ['acme.123', 'TLD must be at least 2'],
    ])('rejects %s', (d) => {
      const r = isValidDomainShape(d);
      expect(r.ok).toBe(false);
    });

    it('enforces label length', () => {
      const tooLong = 'a'.repeat(64) + '.com';
      expect(isValidDomainShape(tooLong)).toEqual({ ok: false, reason: expect.any(String) });
    });

    it('enforces total domain length', () => {
      const longLabel = 'a'.repeat(60);
      const tooLong = `${longLabel}.${longLabel}.${longLabel}.${longLabel}.example.com`;
      expect(tooLong.length).toBeGreaterThan(253);
      expect(isValidDomainShape(tooLong).ok).toBe(false);
    });
  });

  describe('domainSchema (zod)', () => {
    it('lowercases and trims', () => {
      expect(domainSchema.parse('  ACME.com ')).toBe('acme.com');
    });

    it('strips leading www.', () => {
      expect(domainSchema.parse('www.acme.com')).toBe('acme.com');
    });

    it('rejects invalid via ZodError', () => {
      expect(() => domainSchema.parse('not_a_domain')).toThrow(ZodError);
      expect(() => domainSchema.parse('localhost')).toThrow(ZodError);
      expect(() => domainSchema.parse('1.2.3.4')).toThrow(ZodError);
    });
  });

  describe('createDomainBodySchema', () => {
    it('parses a valid body', () => {
      const out = createDomainBodySchema.parse({ domain: 'WWW.Acme.COM' });
      expect(out).toEqual({ domain: 'acme.com' });
    });

    it('rejects missing domain', () => {
      expect(() => createDomainBodySchema.parse({})).toThrow(ZodError);
    });
  });
});
