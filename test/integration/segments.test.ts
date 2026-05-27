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

describeIfInfra('segments API — integration', () => {
  let app: FastifyInstance;
  const natsCapture: Array<{ subject: string; payload: unknown }> = [];

  beforeAll(async () => {
    await runMigrations();
    await reseedRbac();
    app = await buildTestApp();

    const original = app.nats.publish.bind(app.nats);
    app.nats.publish = ((subject: string, payload: unknown) => {
      natsCapture.push({ subject, payload });
      return original(subject, payload);
    }) as typeof app.nats.publish;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    natsCapture.length = 0;
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

  it('POST /segments — creates a static segment and enqueues refresh', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/segments',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { name: 'All Users', type: 'static' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.segment.name).toBe('All Users');
    expect(body.segment.type).toBe('static');

    const refreshMsg = natsCapture.find((m) => m.subject === 'segment.refresh');
    expect(refreshMsg).toBeDefined();
    expect(refreshMsg?.payload).toMatchObject({
      workspaceId: workspace.id,
      segmentId: body.segment.id,
    });
  });

  it('POST /segments — creates a dynamic segment with filterTree', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/segments',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: {
        name: 'Trial Users',
        type: 'dynamic',
        filterTree: {
          operator: 'AND',
          rules: [{ field: 'properties.plan', operator: 'equals', value: 'free' }],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().segment.filterTree.operator).toBe('AND');
  });

  it('POST /segments — rejects dynamic segment without filterTree', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/segments',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { name: 'Bad', type: 'dynamic' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /segments — lists segments', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    await app.inject({ method: 'POST', url: '/api/v1/segments', headers, payload: { name: 'Seg A', type: 'static' } });
    await app.inject({ method: 'POST', url: '/api/v1/segments', headers, payload: { name: 'Seg B', type: 'static' } });

    const res = await app.inject({ method: 'GET', url: '/api/v1/segments', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
  });

  it('GET /segments/:id — returns segment', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/segments', headers, payload: { name: 'Get Me', type: 'static' } });
    const id = created.json().segment.id;

    const res = await app.inject({ method: 'GET', url: `/api/v1/segments/${id}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().segment.name).toBe('Get Me');
  });

  it('GET /segments/:id — returns 404 for missing segment', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/segments/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /segments/:id — updates segment and re-enqueues refresh', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/segments', headers, payload: { name: 'Old Name', type: 'static' } });
    const id = created.json().segment.id;
    natsCapture.length = 0;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/segments/${id}`,
      headers,
      payload: { name: 'New Name' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().segment.name).toBe('New Name');

    const refreshMsg = natsCapture.find((m) => m.subject === 'segment.refresh');
    expect(refreshMsg?.payload).toMatchObject({ workspaceId: workspace.id, segmentId: id });
  });

  it('DELETE /segments/:id — soft-deletes segment', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/segments', headers, payload: { name: 'Delete Me', type: 'static' } });
    const id = created.json().segment.id;

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/segments/${id}`, headers });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: 'GET', url: `/api/v1/segments/${id}`, headers });
    expect(get.statusCode).toBe(404);
  });

  it('POST /segments/:id/refresh — enqueues refresh with locked contract', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/segments', headers, payload: { name: 'Refresh Me', type: 'static' } });
    const id = created.json().segment.id;
    natsCapture.length = 0;

    const res = await app.inject({ method: 'POST', url: `/api/v1/segments/${id}/refresh`, headers });
    expect(res.statusCode).toBe(202);
    expect(res.json().queued).toBe(true);

    const refreshMsg = natsCapture.find((m) => m.subject === 'segment.refresh');
    expect(refreshMsg?.payload).toEqual({ workspaceId: workspace.id, segmentId: id });
  });

  it('GET /segments/:id/preview — returns preview contacts', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    const created = await app.inject({ method: 'POST', url: '/api/v1/segments', headers, payload: { name: 'Preview', type: 'static' } });
    const id = created.json().segment.id;

    const res = await app.inject({ method: 'GET', url: `/api/v1/segments/${id}/preview?limit=10`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('contacts');
    expect(res.json()).toHaveProperty('total');
  });

  // ─── Tenant isolation ─────────────────────────────────────────────────────

  it('cannot access segments from another workspace', async () => {
    const ws1 = await signupOwner('ws1@test.com');
    const ws2 = await signupOwner('ws2@test.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/segments',
      headers: authHeaders(ws1.tokens.accessToken, ws1.workspace.id),
      payload: { name: 'Private', type: 'static' },
    });
    const id = created.json().segment.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/segments/${id}`,
      headers: authHeaders(ws2.tokens.accessToken, ws2.workspace.id),
    });
    expect(res.statusCode).toBe(404);
  });

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/segments' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when missing x-workspace-id', async () => {
    const { tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/segments',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
