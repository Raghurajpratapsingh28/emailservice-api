import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { sendEmailBodySchema } from '@modules/transactional/schemas/send.schema.js';
import {
  createTemplateBodySchema,
  updateTemplateBodySchema,
  listTemplatesQuerySchema,
} from '@modules/transactional/schemas/template.schema.js';

describe('sendEmailBodySchema', () => {
  const baseRaw = {
    to: [{ email: 'alice@example.com', name: 'Alice' }],
    from: { email: 'hello@acme.com', name: 'Acme' },
    subject: 'Hi',
    html: '<h1>Hello</h1>',
  };

  it('accepts a minimal raw send', () => {
    const out = sendEmailBodySchema.parse(baseRaw);
    expect(out.to).toHaveLength(1);
    expect(out.from.email).toBe('hello@acme.com');
  });

  it('accepts a template-only send (no subject required)', () => {
    const out = sendEmailBodySchema.parse({
      to: [{ email: 'a@b.com' }],
      from: { email: 'h@acme.com' },
      templateId: '11111111-1111-4111-8111-111111111111',
      templateData: { first_name: 'Alice' },
    });
    expect(out.templateId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects when neither subject nor template is provided', () => {
    expect(() =>
      sendEmailBodySchema.parse({
        to: [{ email: 'a@b.com' }],
        from: { email: 'h@acme.com' },
        html: '<p>x</p>',
      }),
    ).toThrow(ZodError);
  });

  it('rejects when subject given but neither html nor text', () => {
    expect(() =>
      sendEmailBodySchema.parse({
        to: [{ email: 'a@b.com' }],
        from: { email: 'h@acme.com' },
        subject: 'X',
      }),
    ).toThrow(ZodError);
  });

  it('rejects more than 50 recipients', () => {
    const recipients = Array.from({ length: 51 }, (_, i) => ({ email: `u${i}@b.com` }));
    expect(() =>
      sendEmailBodySchema.parse({ ...baseRaw, to: recipients }),
    ).toThrow(ZodError);
  });

  it('rejects sender at localhost', () => {
    expect(() =>
      sendEmailBodySchema.parse({ ...baseRaw, from: { email: 'a@localhost' } }),
    ).toThrow(ZodError);
  });

  it('rejects sender at IPv4 literal', () => {
    expect(() =>
      sendEmailBodySchema.parse({ ...baseRaw, from: { email: 'a@10.0.0.1' } }),
    ).toThrow(ZodError);
  });

  it('rejects html exceeding 1MB', () => {
    expect(() =>
      sendEmailBodySchema.parse({ ...baseRaw, html: 'x'.repeat(1_000_001) }),
    ).toThrow(ZodError);
  });

  it('rejects too many tags', () => {
    const tags: Record<string, string> = {};
    for (let i = 0; i < 51; i++) {
      tags[`k${i}`] = 'v';
    }
    expect(() => sendEmailBodySchema.parse({ ...baseRaw, tags })).toThrow(ZodError);
  });

  it('accepts idempotencyKey', () => {
    const out = sendEmailBodySchema.parse({ ...baseRaw, idempotencyKey: 'k-123' });
    expect(out.idempotencyKey).toBe('k-123');
  });
});

describe('template schemas', () => {
  it('createTemplate requires htmlBody OR textBody', () => {
    expect(() =>
      createTemplateBodySchema.parse({ name: 'Welcome', subject: 'Hi' }),
    ).toThrow(ZodError);
    expect(
      createTemplateBodySchema.parse({
        name: 'Welcome',
        subject: 'Hi',
        textBody: 'plain',
      }),
    ).toBeDefined();
  });

  it('createTemplate rejects bad name characters', () => {
    expect(() =>
      createTemplateBodySchema.parse({
        name: 'has/slash',
        subject: 'Hi',
        htmlBody: '<p>x</p>',
      }),
    ).toThrow(ZodError);
  });

  it('updateTemplate requires at least one field', () => {
    expect(() => updateTemplateBodySchema.parse({})).toThrow(ZodError);
    expect(updateTemplateBodySchema.parse({ subject: 'New' })).toBeDefined();
  });

  it('listTemplatesQuery transforms latestOnly string to bool', () => {
    const out = listTemplatesQuerySchema.parse({ latestOnly: 'true' });
    expect(out.latestOnly).toBe(true);
    const out2 = listTemplatesQuerySchema.parse({ latestOnly: 'false' });
    expect(out2.latestOnly).toBe(false);
  });
});
