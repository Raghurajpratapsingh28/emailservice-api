import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

describeIfInfra('contacts API — integration', () => {
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

  // ─── Tests ────────────────────────────────────────────────────────────────

  it('POST /contacts — creates a contact', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: {
        email: 'alice@example.com',
        firstName: 'Alice',
        lifecycleStage: 'lead',
        tags: ['trial'],
        properties: { plan: 'free' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.contact.email).toBe('alice@example.com');
    expect(body.contact.tags).toContain('trial');
  });

  it('POST /contacts — normalizes email to lowercase', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { email: 'ALICE@EXAMPLE.COM' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contact.email).toBe('alice@example.com');
  });

  it('POST /contacts — rejects duplicate email', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'dup@example.com' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'dup@example.com' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONTACT_ALREADY_EXISTS');
  });

  it('GET /contacts — lists contacts with pagination', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'a@test.com' } });
    await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'b@test.com' } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts?page=1&pageSize=10', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  it('GET /contacts — filters by tag', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'tagged@test.com', tags: ['vip'] } });
    await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'plain@test.com' } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts?tags=vip', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    expect(res.json().items[0].email).toBe('tagged@test.com');
  });

  it('GET /contacts/:id — returns full contact', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'get@test.com', tags: ['a', 'b'] } });
    const id = created.json().contact.id;

    const res = await app.inject({ method: 'GET', url: `/api/v1/contacts/${id}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().contact.tags).toHaveLength(2);
  });

  it('GET /contacts/:id — returns 404 for missing contact', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/contacts/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /contacts/:id — updates contact fields', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'patch@test.com' } });
    const id = created.json().contact.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers,
      payload: { firstName: 'Updated', lifecycleStage: 'customer', tags: ['new-tag'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().contact.firstName).toBe('Updated');
    expect(res.json().contact.tags).toContain('new-tag');
  });

  it('DELETE /contacts/:id — soft-deletes contact', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'del@test.com' } });
    const id = created.json().contact.id;

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/contacts/${id}`, headers });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: 'GET', url: `/api/v1/contacts/${id}`, headers });
    expect(get.statusCode).toBe(404);
  });

  it('POST /contacts/bulk-import — imports multiple contacts', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts/bulk-import',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: {
        contacts: [
          { email: 'bulk1@test.com', tags: ['imported'] },
          { email: 'bulk2@test.com' },
          { email: 'bulk1@test.com' }, // duplicate — should be skipped
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(2);
    expect(res.json().skipped).toBe(1);
  });

  it('POST /contacts/:id/suppress — suppresses contact', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'sup@test.com' } });
    const id = created.json().contact.id;

    const res = await app.inject({ method: 'POST', url: `/api/v1/contacts/${id}/suppress`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().contact.emailSuppressed).toBe(true);
  });

  it('POST /contacts/:id/unsuppress — unsuppresses contact', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { email: 'unsup@test.com' } });
    const id = created.json().contact.id;

    await app.inject({ method: 'POST', url: `/api/v1/contacts/${id}/suppress`, headers });
    const res = await app.inject({ method: 'POST', url: `/api/v1/contacts/${id}/unsuppress`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().contact.emailSuppressed).toBe(false);
  });

  // ─── Tenant isolation ─────────────────────────────────────────────────────

  it('cannot access contacts from another workspace', async () => {
    const ws1 = await signupOwner('ws1@test.com');
    const ws2 = await signupOwner('ws2@test.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: authHeaders(ws1.tokens.accessToken, ws1.workspace.id),
      payload: { email: 'private@test.com' },
    });
    const id = created.json().contact.id;

    // ws2 tries to access ws1's contact
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: authHeaders(ws2.tokens.accessToken, ws2.workspace.id),
    });
    expect(res.statusCode).toBe(404);
  });

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  it('returns 403 when missing x-workspace-id header', async () => {
    const { tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/contacts',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });
    expect(res.statusCode).toBe(401);
  });
});
