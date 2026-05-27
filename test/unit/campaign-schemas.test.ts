import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  createCampaignBodySchema,
  listCampaignsQuerySchema,
  scheduleCampaignBodySchema,
  updateCampaignBodySchema,
} from '@modules/campaigns/schemas/campaign.schema.js';

describe('createCampaignBodySchema', () => {
  it('accepts a minimal body', () => {
    const out = createCampaignBodySchema.parse({ name: 'Welcome' });
    expect(out.name).toBe('Welcome');
  });

  it('accepts full body', () => {
    const out = createCampaignBodySchema.parse({
      name: 'Welcome',
      type: 'regular',
      subject: 'Hi',
      previewText: 'preview',
      from: { email: 'h@acme.com', name: 'Acme' },
      replyTo: 'r@acme.com',
      html: '<p>x</p>',
      text: 'x',
      templateId: '11111111-1111-4111-8111-111111111111',
      segmentId: '22222222-2222-4222-8222-222222222222',
    });
    expect(out.from?.email).toBe('h@acme.com');
  });

  it('rejects empty name', () => {
    expect(() => createCampaignBodySchema.parse({ name: '' })).toThrow(ZodError);
  });

  it('rejects sender at localhost / IPv4', () => {
    expect(() =>
      createCampaignBodySchema.parse({ name: 'X', from: { email: 'a@localhost' } }),
    ).toThrow(ZodError);
    expect(() =>
      createCampaignBodySchema.parse({ name: 'X', from: { email: 'a@10.0.0.1' } }),
    ).toThrow(ZodError);
  });

  it('rejects unknown type', () => {
    expect(() =>
      createCampaignBodySchema.parse({ name: 'X', type: 'unknown_type' }),
    ).toThrow(ZodError);
  });
});

describe('updateCampaignBodySchema', () => {
  it('requires version', () => {
    expect(() => updateCampaignBodySchema.parse({ name: 'X' })).toThrow(ZodError);
  });

  it('requires at least one editable field', () => {
    expect(() => updateCampaignBodySchema.parse({ version: 1 })).toThrow(ZodError);
  });

  it('accepts a single field with version', () => {
    const out = updateCampaignBodySchema.parse({ name: 'X', version: 1 });
    expect(out.name).toBe('X');
    expect(out.version).toBe(1);
  });

  it('allows nullable fields for explicit clearing', () => {
    const out = updateCampaignBodySchema.parse({
      version: 1,
      replyTo: null,
      html: null,
      text: null,
      templateId: null,
      segmentId: null,
    });
    expect(out.replyTo).toBeNull();
    expect(out.html).toBeNull();
  });
});

describe('scheduleCampaignBodySchema', () => {
  it('coerces ISO string to Date', () => {
    const out = scheduleCampaignBodySchema.parse({ scheduledAt: '2026-12-31T00:00:00Z' });
    expect(out.scheduledAt).toBeInstanceOf(Date);
  });

  it('rejects invalid date', () => {
    expect(() =>
      scheduleCampaignBodySchema.parse({ scheduledAt: 'not-a-date' }),
    ).toThrow(ZodError);
  });
});

describe('listCampaignsQuerySchema', () => {
  it('parses valid filters', () => {
    const out = listCampaignsQuerySchema.parse({
      status: 'draft',
      type: 'regular',
      search: 'welcome',
      page: '2',
      pageSize: '50',
    });
    expect(out.status).toBe('draft');
    expect(out.page).toBe(2);
    expect(out.pageSize).toBe(50);
  });

  it('rejects unknown status', () => {
    expect(() => listCampaignsQuerySchema.parse({ status: 'unknown' })).toThrow(ZodError);
  });
});
