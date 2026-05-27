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

const validGraph = {
  nodes: [
    { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'Trial Started' } },
    { id: 'email_1', type: 'email', config: { subject: 'Welcome!', fromEmail: 'hi@acme.com', html: '<h1>Hi</h1>' } },
    { id: 'delay_1', type: 'delay', config: { durationSeconds: 86400 } },
    { id: 'end_1', type: 'end' },
  ],
  edges: [
    { from: 'trigger_1', to: 'email_1' },
    { from: 'email_1', to: 'delay_1' },
    { from: 'delay_1', to: 'end_1' },
  ],
};

describeIfInfra('workflows API — integration', () => {
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

  async function createWorkflow(token: string, workspaceId: string, name = 'My Workflow') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: authHeaders(token, workspaceId),
      payload: { name, graph: validGraph },
    });
    expect(res.statusCode).toBe(201);
    return res.json().workflow as { id: string; status: string };
  }

  // ─── Tests ────────────────────────────────────────────────────────────────

  it('POST /workflows — creates a draft workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { name: 'Welcome Flow', graph: validGraph },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.workflow.name).toBe('Welcome Flow');
    expect(body.workflow.status).toBe('draft');
  });

  it('POST /workflows — rejects invalid graph (no trigger)', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: {
        name: 'Bad',
        graph: {
          nodes: [{ id: 'end_1', type: 'end' }],
          edges: [],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /workflows — rejects graph with cycle', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: {
        name: 'Cyclic',
        graph: {
          nodes: [
            { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'X' } },
            { id: 'email_1', type: 'email', config: { subject: 'Hi', fromEmail: 'a@b.com', html: '<p>x</p>' } },
            { id: 'end_1', type: 'end' },
          ],
          edges: [
            { from: 'trigger_1', to: 'email_1' },
            { from: 'email_1', to: 'trigger_1' }, // cycle
            { from: 'email_1', to: 'end_1' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /workflows — lists workflows', async () => {
    const { workspace, tokens } = await signupOwner();
    const headers = authHeaders(tokens.accessToken, workspace.id);
    await createWorkflow(tokens.accessToken, workspace.id, 'Flow A');
    await createWorkflow(tokens.accessToken, workspace.id, 'Flow B');

    const res = await app.inject({ method: 'GET', url: '/api/v1/workflows', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
  });

  it('GET /workflows/:id — returns full workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${wf.id}`,
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflow.graph).toBeDefined();
    expect(res.json().workflow.executionStats).toBeDefined();
  });

  it('GET /workflows/:id — returns 404 for missing workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /workflows/:id — updates draft workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workflows/${wf.id}`,
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { name: 'Updated Name' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflow.name).toBe('Updated Name');
  });

  it('PATCH /workflows/:id — rejects update on published workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);

    // Publish first
    await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/publish`,
      headers: authHeaders(tokens.accessToken, workspace.id),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workflows/${wf.id}`,
      headers: authHeaders(tokens.accessToken, workspace.id),
      payload: { name: 'Should Fail' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /workflows/:id/publish — publishes and enqueues workflow.register', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/publish`,
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflow.status).toBe('published');

    const msg = natsCapture.find((m) => m.subject === 'workflow.register');
    expect(msg).toBeDefined();
    expect(msg?.payload).toEqual({ workspaceId: workspace.id, workflowId: wf.id });
  });

  it('POST /workflows/:id/publish — rejects duplicate publish', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);
    const headers = authHeaders(tokens.accessToken, workspace.id);

    await app.inject({ method: 'POST', url: `/api/v1/workflows/${wf.id}/publish`, headers });
    const res = await app.inject({ method: 'POST', url: `/api/v1/workflows/${wf.id}/publish`, headers });
    expect(res.statusCode).toBe(409);
  });

  it('POST /workflows/:id/pause — pauses a published workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);
    const headers = authHeaders(tokens.accessToken, workspace.id);

    await app.inject({ method: 'POST', url: `/api/v1/workflows/${wf.id}/publish`, headers });
    const res = await app.inject({ method: 'POST', url: `/api/v1/workflows/${wf.id}/pause`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflow.status).toBe('paused');
  });

  it('POST /workflows/:id/pause — rejects pause on draft', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/pause`,
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /workflows/:id/resume — resumes a paused workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);
    const headers = authHeaders(tokens.accessToken, workspace.id);

    await app.inject({ method: 'POST', url: `/api/v1/workflows/${wf.id}/publish`, headers });
    await app.inject({ method: 'POST', url: `/api/v1/workflows/${wf.id}/pause`, headers });
    const res = await app.inject({ method: 'POST', url: `/api/v1/workflows/${wf.id}/resume`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().workflow.status).toBe('published');
  });

  it('DELETE /workflows/:id — soft-deletes workflow', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);
    const headers = authHeaders(tokens.accessToken, workspace.id);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/workflows/${wf.id}`, headers });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: 'GET', url: `/api/v1/workflows/${wf.id}`, headers });
    expect(get.statusCode).toBe(404);
  });

  it('GET /workflows/:id/executions — returns execution list', async () => {
    const { workspace, tokens } = await signupOwner();
    const wf = await createWorkflow(tokens.accessToken, workspace.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${wf.id}/executions`,
      headers: authHeaders(tokens.accessToken, workspace.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('items');
    expect(res.json()).toHaveProperty('total');
  });

  // ─── Tenant isolation ─────────────────────────────────────────────────────

  it('cannot access workflow from another workspace', async () => {
    const ws1 = await signupOwner('ws1@test.com');
    const ws2 = await signupOwner('ws2@test.com');

    const wf = await createWorkflow(ws1.tokens.accessToken, ws1.workspace.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${wf.id}`,
      headers: authHeaders(ws2.tokens.accessToken, ws2.workspace.id),
    });
    expect(res.statusCode).toBe(404);
  });

  it('cannot publish workflow from another workspace', async () => {
    const ws1 = await signupOwner('ws1@test.com');
    const ws2 = await signupOwner('ws2@test.com');

    const wf = await createWorkflow(ws1.tokens.accessToken, ws1.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/publish`,
      headers: authHeaders(ws2.tokens.accessToken, ws2.workspace.id),
    });
    expect(res.statusCode).toBe(404);
  });

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/workflows' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when missing x-workspace-id', async () => {
    const { tokens } = await signupOwner();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
