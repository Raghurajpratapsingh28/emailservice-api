import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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

describeIfInfra('campaigns — integration', () => {
  let app: FastifyInstance;

  /** Captured NATS publishes for assertion of the locked queue contract. */
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

  // ─── Helpers ────────────────────────────────────────────────────────────

  async function signupOwner(email: string) {
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

  async function seedVerifiedDomain(workspaceId: string, domain: string) {
    const { domains } = await import('@shared/database/schema/domains.js');
    await app.db.insert(domains).values({
      workspaceId,
      domain,
      sesIdentity: domain,
      status: 'verified',
      verifiedAt: new Date(),
    });
  }

  async function seedSegment(workspaceId: string, count: number, name = 'All Contacts') {
    const { segments } = await import('@shared/database/schema/segments.js');
    const rows = await app.db
      .insert(segments)
      .values({ workspaceId, name, status: 'active', contactCount: count })
      .returning();
    return rows[0]!;
  }

  function authHeaders(token: string, workspaceId: string) {
    return {
      authorization: `Bearer ${token}`,
      'x-workspace-id': workspaceId,
    };
  }

  // ─── 1. Create + list + get ─────────────────────────────────────────────

  it('creates a campaign in draft status and returns it from list/get', async () => {
    const u = await signupOwner('o1@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: authHeaders(u.tokens.accessToken, u.workspace.id),
      payload: {
        name: 'Welcome',
        type: 'regular',
        subject: 'Welcome',
        html: '<p>hi</p>',
      },
    });
    expect(res.statusCode).toBe(201);
    const campaign = res.json().campaign;
    expect(campaign.status).toBe('draft');
    expect(campaign.name).toBe('Welcome');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns',
      headers: authHeaders(u.tokens.accessToken, u.workspace.id),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campaign.id}`,
      headers: authHeaders(u.tokens.accessToken, u.workspace.id),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().campaign.id).toBe(campaign.id);
  });

  // ─── 2. Duplicate campaign name ─────────────────────────────────────────

  it('rejects duplicate campaign name in same workspace', async () => {
    const u = await signupOwner('o2@example.com');
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: { name: 'X' },
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: { name: 'X' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CAMPAIGN_NAME_TAKEN');
  });

  // ─── 3. Invalid segment ─────────────────────────────────────────────────

  it('rejects creation with a segment that does not belong to workspace', async () => {
    const a = await signupOwner('a@example.com');
    const b = await signupOwner('b@example.com');
    const seg = await seedSegment(b.workspace.id, 100);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: authHeaders(a.tokens.accessToken, a.workspace.id),
      payload: { name: 'X', segmentId: seg.id },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('INVALID_SEGMENT');
  });

  // ─── 4. Update — only drafts ────────────────────────────────────────────

  it('updates content on a draft and bumps version', async () => {
    const u = await signupOwner('o4@example.com');
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: { name: 'A' },
    });
    const c = created.json().campaign;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${c.id}`,
      headers,
      payload: { subject: 'New subject', version: c.version },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().campaign.subject).toBe('New subject');
    expect(updated.json().campaign.version).toBe(c.version + 1);

    // Stale version → 409
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${c.id}`,
      headers,
      payload: { subject: 'Stale', version: c.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
  });

  // ─── 5. Schedule validation ─────────────────────────────────────────────

  it('rejects schedule in the past, accepts in the future', async () => {
    const u = await signupOwner('o5@example.com');
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: { name: 'A' },
    });
    const c = created.json().campaign;

    const past = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/schedule`,
      headers,
      payload: { scheduledAt: '2000-01-01T00:00:00Z' },
    });
    expect(past.statusCode).toBe(400);
    expect(past.json().error.code).toBe('VALIDATION_ERROR');

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/schedule`,
      headers,
      payload: { scheduledAt: future },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().campaign.status).toBe('scheduled');
    expect(ok.json().campaign.scheduledAt).toBeTruthy();
  });

  // ─── 6. Send — empty audience ───────────────────────────────────────────

  it('rejects send when segment has no audience', async () => {
    const u = await signupOwner('o6@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const seg = await seedSegment(u.workspace.id, 0); // empty
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: {
        name: 'A',
        subject: 'S',
        html: '<p>x</p>',
        from: { email: 'h@acme.com' },
        segmentId: seg.id,
      },
    });
    const c = created.json().campaign;

    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/send`,
      headers,
      payload: {},
    });
    expect(send.statusCode).toBe(400);
    expect(send.json().error.code).toBe('VALIDATION_ERROR');
    expect(send.json().error.details?.code ?? send.json().error.message).toMatch(
      /EMPTY_SEGMENT|empty/i,
    );
  });

  // ─── 7. Send — locked queue contract ─────────────────────────────────────

  it('sends a campaign and publishes the locked queue contract', async () => {
    const u = await signupOwner('o7@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const seg = await seedSegment(u.workspace.id, 100);
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: {
        name: 'Welcome',
        subject: 'Welcome',
        previewText: 'Get started',
        html: '<h1>Hello</h1>',
        text: 'Hello',
        from: { email: 'hello@acme.com', name: 'Acme' },
        replyTo: 'support@acme.com',
        segmentId: seg.id,
      },
    });
    const c = created.json().campaign;

    natsCapture.length = 0;
    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/send`,
      headers,
      payload: {},
    });
    expect(send.statusCode).toBe(202);
    expect(send.json()).toMatchObject({ campaignId: c.id, status: 'sending', recipientCount: 100 });

    const queued = natsCapture.find((x) => x.subject === 'campaign.send.start');
    expect(queued).toBeDefined();
    const payload = queued!.payload as Record<string, unknown>;
    expect(payload.jobId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.workspaceId).toBe(u.workspace.id);
    expect(payload.campaignId).toBe(c.id);
    expect(payload.segmentId).toBe(seg.id);
    expect(payload.sender).toEqual({ email: 'hello@acme.com', name: 'Acme' });
    expect(payload.replyTo).toBe('support@acme.com');
    expect(payload.subject).toBe('Welcome');
    expect(payload.html).toBe('<h1>Hello</h1>');
    expect(payload.text).toBe('Hello');
  });

  // ─── 8. Sender domain not verified ──────────────────────────────────────

  it('rejects send when sender domain is not verified', async () => {
    const u = await signupOwner('o8@example.com');
    const seg = await seedSegment(u.workspace.id, 100);
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: { name: 'Z' },
    });
    const c = created.json().campaign;

    // Patch in subject + html + segment + from (sender domain NOT verified)
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${c.id}`,
      headers,
      payload: {
        version: c.version,
        subject: 'S',
        html: '<p>x</p>',
        from: { email: 'h@unverified.example' },
        segmentId: seg.id,
      },
    });

    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/send`,
      headers,
      payload: {},
    });
    expect(send.statusCode).toBe(403);
    expect(send.json().error.code).toBe('SENDER_DOMAIN_NOT_VERIFIED');
  });

  // ─── 9. Pause + resume flow ─────────────────────────────────────────────

  it('pauses a scheduled campaign, then resumes it', async () => {
    const u = await signupOwner('o9@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const seg = await seedSegment(u.workspace.id, 50);
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: {
        name: 'PR',
        subject: 'S',
        html: '<p>x</p>',
        from: { email: 'h@acme.com' },
        segmentId: seg.id,
      },
    });
    const c = created.json().campaign;

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/schedule`,
      headers,
      payload: { scheduledAt: future },
    });

    const pause = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/pause`,
      headers,
      payload: {},
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().campaign.status).toBe('paused');

    const resume = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/resume`,
      headers,
      payload: {},
    });
    expect(resume.statusCode).toBe(200);
    // Was scheduled in the future → resume target is 'scheduled'
    expect(resume.json().campaign.status).toBe('scheduled');
  });

  it('cannot pause a draft campaign', async () => {
    const u = await signupOwner('o10@example.com');
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: { name: 'Q' },
    });
    const c = created.json().campaign;

    const pause = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${c.id}/pause`,
      headers,
      payload: {},
    });
    expect(pause.statusCode).toBe(403);
    expect(pause.json().error.code).toBe('INVALID_CAMPAIGN_STATE');
  });

  // ─── 10. Tenant isolation ───────────────────────────────────────────────

  it('tenant isolation: cross-workspace campaign lookup returns 404', async () => {
    const a = await signupOwner('cross-a@example.com');
    const b = await signupOwner('cross-b@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: authHeaders(a.tokens.accessToken, a.workspace.id),
      payload: { name: 'A' },
    });
    const id = created.json().campaign.id;

    // B uses its own workspace id → 404
    const tryRead = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${id}`,
      headers: authHeaders(b.tokens.accessToken, b.workspace.id),
    });
    expect(tryRead.statusCode).toBe(404);
    expect(tryRead.json().error.code).toBe('CAMPAIGN_NOT_FOUND');

    // B forges A's workspace header → guard rejects
    const forged = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${id}`,
      headers: authHeaders(b.tokens.accessToken, a.workspace.id),
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json().error.code).toBe('WORKSPACE_ACCESS_DENIED');
  });

  // ─── 11. RBAC ────────────────────────────────────────────────────────────

  it('viewer cannot create or send (403); can read', async () => {
    const owner = await signupOwner('rbac-o@example.com');
    const viewer = await signupOwner('rbac-v@example.com');

    const { roles, workspaceMembers } = await import('@shared/database/schema/index.js');
    const viewerRole = (
      await app.db.select().from(roles).where(eq(roles.slug, 'viewer'))
    )[0]!;
    await app.db.insert(workspaceMembers).values({
      workspaceId: owner.workspace.id,
      userId: viewer.user.id,
      roleId: viewerRole.id,
    });
    await app.services.rbac.invalidate(owner.workspace.id, viewer.user.id);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: authHeaders(viewer.tokens.accessToken, owner.workspace.id),
      payload: { name: 'X' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns',
      headers: authHeaders(viewer.tokens.accessToken, owner.workspace.id),
    });
    expect(list.statusCode).toBe(200);
  });

  it('member can write but cannot send (403)', async () => {
    const owner = await signupOwner('mem-o@example.com');
    await seedVerifiedDomain(owner.workspace.id, 'acme.com');
    const seg = await seedSegment(owner.workspace.id, 10);
    const member = await signupOwner('mem-u@example.com');

    const { roles, workspaceMembers } = await import('@shared/database/schema/index.js');
    const memberRole = (
      await app.db.select().from(roles).where(eq(roles.slug, 'member'))
    )[0]!;
    await app.db.insert(workspaceMembers).values({
      workspaceId: owner.workspace.id,
      userId: member.user.id,
      roleId: memberRole.id,
    });
    await app.services.rbac.invalidate(owner.workspace.id, member.user.id);

    const headers = authHeaders(member.tokens.accessToken, owner.workspace.id);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: {
        name: 'M',
        subject: 'S',
        html: '<p>x</p>',
        from: { email: 'h@acme.com' },
        segmentId: seg.id,
      },
    });
    expect(created.statusCode).toBe(201);

    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${created.json().campaign.id}/send`,
      headers,
      payload: {},
    });
    expect(send.statusCode).toBe(403);
    expect(send.json().error.code).toBe('PERMISSION_DENIED');
  });

  // ─── 12. Queue publish failure rolls back status ─────────────────────────

  it('queue publish failure rolls back campaign status from sending', async () => {
    const u = await signupOwner('o12@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const seg = await seedSegment(u.workspace.id, 25);
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: {
        name: 'F',
        subject: 'S',
        html: '<p>x</p>',
        from: { email: 'h@acme.com' },
        segmentId: seg.id,
      },
    });
    const c = created.json().campaign;

    const original = app.nats.publish.bind(app.nats);
    app.nats.publish = (() => {
      throw new Error('NATS down');
    }) as typeof app.nats.publish;
    try {
      const send = await app.inject({
        method: 'POST',
        url: `/api/v1/campaigns/${c.id}/send`,
        headers,
        payload: {},
      });
      expect(send.statusCode).toBe(500);
    } finally {
      app.nats.publish = original;
    }

    // Status should be back to 'draft' (its previous status), not 'sending'
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${c.id}`,
      headers,
    });
    expect(after.json().campaign.status).toBe('draft');
  });

  // ─── 13. Delete ──────────────────────────────────────────────────────────

  it('deletes a draft (soft) and cannot be re-fetched', async () => {
    const u = await signupOwner('o13@example.com');
    const headers = authHeaders(u.tokens.accessToken, u.workspace.id);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers,
      payload: { name: 'D' },
    });
    const id = created.json().campaign.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/campaigns/${id}`,
      headers,
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${id}`,
      headers,
    });
    expect(after.statusCode).toBe(404);
  });

  // suppress unused
  void vi;
});
