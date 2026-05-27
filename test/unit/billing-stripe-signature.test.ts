import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createStripeClient, StripeWebhookSignatureError } from '@shared/payments/stripe.js';

/**
 * Stripe-flavoured signature header generator. We don't have access to
 * Stripe.webhooks.generateTestHeaderString in older SDK versions, so we
 * implement the canonical scheme here:
 *
 *   signature = "t={ts},v1=" + HMAC_SHA256(secret, `${ts}.${rawBody}`)
 */
function signStripePayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  const sig = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

describe('Stripe webhook signature verification (integration)', () => {
  const secret = 'whsec_test_dummy';
  const client = createStripeClient({ secretKey: 'sk_test_dummy', webhookSecret: secret });

  it('verifies a correctly signed payload', () => {
    const body = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      type: 'invoice.created',
      api_version: '2024-12-18.acacia',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_test' } },
    });
    const sig = signStripePayload(body, secret);
    const event = client.constructEvent(body, sig);
    expect(event.id).toBe('evt_test');
    expect(event.type).toBe('invoice.created');
  });

  it('rejects payload with wrong signature', () => {
    const body = JSON.stringify({ id: 'evt_test', type: 'invoice.created', created: Date.now() / 1000, data: {} });
    const sig = signStripePayload(body, 'wrong_secret');
    expect(() => client.constructEvent(body, sig)).toThrow(StripeWebhookSignatureError);
  });

  it('rejects modified payload (signature was for original body)', () => {
    const original = JSON.stringify({ id: 'evt_test', type: 'invoice.created', created: Date.now() / 1000, data: {} });
    const sig = signStripePayload(original, secret);
    const modified = original.replace('invoice.created', 'invoice.payment_succeeded');
    expect(() => client.constructEvent(modified, sig)).toThrow(StripeWebhookSignatureError);
  });

  it('rejects malformed signature header', () => {
    const body = JSON.stringify({ id: 'evt_x', type: 'invoice.created', created: 1, data: {} });
    expect(() => client.constructEvent(body, 'not-a-valid-stripe-signature')).toThrow(StripeWebhookSignatureError);
  });

  it('rejects empty signature', () => {
    const body = JSON.stringify({ id: 'evt_x', type: 'invoice.created', created: 1, data: {} });
    expect(() => client.constructEvent(body, '')).toThrow(StripeWebhookSignatureError);
  });
});
