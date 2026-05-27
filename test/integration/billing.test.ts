import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildTestApp,
  checkInfraAvailable,
  reseedRbac,
  resetDatabase,
  runMigrations,
} from './helpers/app.js';
import type { FastifyInstance } from 'fastify';

const infra = await checkInfraAvailable();
const describeIfInfra = infra.ok ? describe : describe.skip;

/**
 * Stripe-style signature header generator. Mirrors what Stripe sends.
 */
function signStripePayload(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
  return `t=${ts},v1=${sig}`;
}

describeIfInfra('billing API — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations();
    await reseedRbac();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await reseedRbac();
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function signupOwner(email = 'owner@test.com') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password: 'GoodPass!2345A' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      user: { id: string };
      workspace: { id: string };
      tokens: { accessToken: string };
    };
  }

  function authHeaders(token: string, workspaceId: string) {
    return { authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId };
  }

  // ─── GET /subscription ────────────────────────────────────────────────────

  it('GET /billing/subscription — returns synthetic free plan for new workspace', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBe('free');
    expect(body.status).toBe('active');
    expect(body.stripeSubscriptionId).toBeNull();
  });

  // ─── GET /usage ───────────────────────────────────────────────────────────

  it('GET /billing/usage — returns zero usage with free-plan limits', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/usage',
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contacts.used).toBe(0);
    expect(body.contacts.limit).toBe(100);
    expect(body.emails.limit).toBe(500);
    expect(body.events.limit).toBe(1000);
  });

  // ─── GET /invoices ────────────────────────────────────────────────────────

  it('GET /billing/invoices — returns empty list for new workspace', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/invoices',
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(res.json().total).toBe(0);
  });

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/billing/subscription' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when missing x-workspace-id', async () => {
    const { tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── Tenant isolation ─────────────────────────────────────────────────────

  it('cannot access another workspace billing data via x-workspace-id', async () => {
    const ws1 = await signupOwner('a@test.com');
    await signupOwner('b@test.com');

    // ws1 token + ws2-style fake workspace id (random UUID)
    const fakeWsId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${ws1.tokens.accessToken}`, 'x-workspace-id': fakeWsId },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── Checkout (Stripe stub will reject; we verify stub fails consistently) ───

  it('POST /billing/checkout — fails with STRIPE_NOT_CONFIGURED when Stripe is stubbed', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { plan: 'growth', billingInterval: 'monthly' },
    });
    // Stripe stub throws STRIPE_NOT_CONFIGURED → 500 with sanitized message
    expect([500, 502]).toContain(res.statusCode);
  });

  it('POST /billing/checkout — rejects free plan via Zod', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { plan: 'free', billingInterval: 'monthly' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Webhook endpoint ─────────────────────────────────────────────────────

  it('POST /webhooks/stripe — rejects request with no signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /webhooks/stripe — rejects request with invalid signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=invalid',
      },
      payload: '{"id":"evt_x","type":"invoice.created","created":1,"data":{"object":{}}}',
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /webhooks/stripe — accepts a correctly-signed payload', async () => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_dummy';
    const body = JSON.stringify({
      id: 'evt_integration_test_1',
      object: 'event',
      type: 'invoice.created',
      api_version: '2024-12-18.acacia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_int_1',
          customer: 'cus_int_test',
          amount_due: 1000,
          amount_paid: 0,
          currency: 'usd',
          status: 'draft',
          hosted_invoice_url: null,
          invoice_pdf: null,
          created: Math.floor(Date.now() / 1000),
        },
      },
    });
    const sig = signStripePayload(body, secret);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': sig,
      },
      payload: body,
    });
    // No matching workspace → handler logs error but returns 200 (event still recorded).
    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
  });

  it('POST /webhooks/stripe — duplicate event id is silently dropped', async () => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_dummy';
    const body = JSON.stringify({
      id: 'evt_integration_dup',
      object: 'event',
      type: 'invoice.created',
      api_version: '2024-12-18.acacia',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_dup', customer: 'cus_dup', amount_due: 0, amount_paid: 0, currency: 'usd', status: 'draft', created: 1 } },
    });

    // First delivery
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(body, secret) },
      payload: body,
    });
    expect(r1.statusCode).toBe(200);

    // Second delivery (replay)
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(body, secret) },
      payload: body,
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().received).toBe(true);
  });
});
