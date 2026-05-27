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

describeIfInfra('transactional emails — integration', () => {
  let app: FastifyInstance;

  // We capture every NATS publish to verify the locked queue contract.
  const natsCapture: Array<{ subject: string; payload: unknown }> = [];

  beforeAll(async () => {
    await runMigrations();
    await reseedRbac();
    app = await buildTestApp();

    // Wrap nats.publish so we can inspect calls.
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
      user: { id: string; email: string };
      workspace: { id: string };
      tokens: { accessToken: string; refreshToken: string };
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

  // ─── 1. Raw send happy path + locked queue contract ─────────────────────

  it('queues a raw send and publishes the locked queue contract', async () => {
    const u = await signupOwner('o1@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers: {
        authorization: `Bearer ${u.tokens.accessToken}`,
        'x-workspace-id': u.workspace.id,
      },
      payload: {
        to: [{ email: 'alice@example.com', name: 'Alice' }],
        from: { email: 'hello@acme.com', name: 'Acme' },
        replyTo: 'support@acme.com',
        subject: 'Welcome',
        html: '<h1>Hello</h1>',
        text: 'Hello',
        tags: { source: 'signup' },
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('queued');
    expect(body.sendId).toMatch(/^[0-9a-f-]{36}$/i);

    // Verify the locked queue contract
    const queued = natsCapture.find((c) => c.subject === 'email.send.transactional');
    expect(queued).toBeDefined();
    const payload = queued!.payload as Record<string, unknown>;
    expect(payload.jobId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.workspaceId).toBe(u.workspace.id);
    expect(payload.sendId).toBe(body.sendId);
    expect(payload.to).toEqual([{ email: 'alice@example.com', name: 'Alice' }]);
    expect(payload.from).toEqual({ email: 'hello@acme.com', name: 'Acme' });
    expect(payload.replyTo).toBe('support@acme.com');
    expect(payload.subject).toBe('Welcome');
    expect(payload.html).toBe('<h1>Hello</h1>');
    expect(payload.text).toBe('Hello');
    expect(payload.tags).toEqual({ source: 'signup' });
    expect(payload.provider).toBe('ses');
  });

  // ─── 2. Unverified sender domain ────────────────────────────────────────

  it('rejects sends from an unverified workspace domain', async () => {
    const u = await signupOwner('o2@example.com');
    // No domain seeded.

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers: {
        authorization: `Bearer ${u.tokens.accessToken}`,
        'x-workspace-id': u.workspace.id,
      },
      payload: {
        to: [{ email: 'a@b.com' }],
        from: { email: 'h@unverified.com' },
        subject: 'X',
        html: '<p>x</p>',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('SENDER_DOMAIN_NOT_VERIFIED');
  });

  // ─── 3. Idempotency ──────────────────────────────────────────────────────

  it('idempotency: duplicate request returns the same sendId without re-queueing', async () => {
    const u = await signupOwner('o3@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');

    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };
    const payload = {
      to: [{ email: 'a@b.com' }],
      from: { email: 'h@acme.com' },
      subject: 'Hi',
      html: '<p>x</p>',
      idempotencyKey: 'test-key-1',
    };

    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers,
      payload,
    });
    expect(r1.statusCode).toBe(202);
    const id1 = r1.json().sendId;

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers,
      payload,
    });
    expect(r2.statusCode).toBe(202);
    expect(r2.json().sendId).toBe(id1);

    // Only one publish should have happened
    const publishes = natsCapture.filter(
      (c) => c.subject === 'email.send.transactional',
    );
    expect(publishes).toHaveLength(1);
  });

  it('idempotency: same key with different body returns 409 IDEMPOTENT_REPLAY', async () => {
    const u = await signupOwner('o4@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };

    await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers,
      payload: {
        to: [{ email: 'a@b.com' }],
        from: { email: 'h@acme.com' },
        subject: 'A',
        html: '<p>a</p>',
        idempotencyKey: 'k-x',
      },
    });

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers,
      payload: {
        to: [{ email: 'a@b.com' }],
        from: { email: 'h@acme.com' },
        subject: 'B',
        html: '<p>b</p>',
        idempotencyKey: 'k-x',
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENT_REPLAY');
  });

  // ─── 4. Tenant isolation ────────────────────────────────────────────────

  it('tenant isolation: workspace A cannot see workspace B sends', async () => {
    const a = await signupOwner('a@example.com');
    const b = await signupOwner('b@example.com');
    await seedVerifiedDomain(a.workspace.id, 'acme.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers: {
        authorization: `Bearer ${a.tokens.accessToken}`,
        'x-workspace-id': a.workspace.id,
      },
      payload: {
        to: [{ email: 'x@y.com' }],
        from: { email: 'h@acme.com' },
        subject: 'X',
        html: '<p>x</p>',
      },
    });
    const sendId = created.json().sendId;

    // B tries to read A's send via B's own workspace id → 404
    const tryRead = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/${sendId}`,
      headers: {
        authorization: `Bearer ${b.tokens.accessToken}`,
        'x-workspace-id': b.workspace.id,
      },
    });
    expect(tryRead.statusCode).toBe(404);
    expect(tryRead.json().error.code).toBe('EMAIL_NOT_FOUND');

    // B forges A's workspace header → workspaceGuard rejects
    const forged = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/${sendId}`,
      headers: {
        authorization: `Bearer ${b.tokens.accessToken}`,
        'x-workspace-id': a.workspace.id,
      },
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json().error.code).toBe('WORKSPACE_ACCESS_DENIED');
  });

  // ─── 5. Template send ────────────────────────────────────────────────────

  it('creates + publishes a template, then uses it in a send', async () => {
    const u = await signupOwner('o5@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };

    // Create + publish template in one call
    const tmpl = await app.inject({
      method: 'POST',
      url: '/api/v1/email-templates',
      headers,
      payload: {
        name: 'Welcome',
        subject: 'Welcome {{first_name}}',
        htmlBody: '<h1>Hello {{first_name}}</h1>',
        textBody: 'Hello {{first_name}}',
        publish: true,
      },
    });
    expect(tmpl.statusCode).toBe(201);
    const templateId = tmpl.json().template.id;
    expect(tmpl.json().template.status).toBe('published');

    // Send using template
    natsCapture.length = 0;
    const send = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers,
      payload: {
        to: [{ email: 'alice@x.com' }],
        from: { email: 'h@acme.com' },
        templateId,
        templateData: { first_name: 'Alice' },
      },
    });
    expect(send.statusCode).toBe(202);

    const queued = natsCapture.find((c) => c.subject === 'email.send.transactional');
    const payload = queued!.payload as Record<string, unknown>;
    expect(payload.subject).toBe('Welcome Alice');
    expect(payload.html).toBe('<h1>Hello Alice</h1>');
    expect(payload.text).toBe('Hello Alice');
  });

  it('rejects sending against an unpublished (draft) template', async () => {
    const u = await signupOwner('o6@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };

    const tmpl = await app.inject({
      method: 'POST',
      url: '/api/v1/email-templates',
      headers,
      payload: {
        name: 'Draft',
        subject: 'Draft',
        htmlBody: '<p>x</p>',
      },
    });
    const templateId = tmpl.json().template.id;

    const send = await app.inject({
      method: 'POST',
      url: '/api/v1/emails/send',
      headers,
      payload: {
        to: [{ email: 'a@x.com' }],
        from: { email: 'h@acme.com' },
        templateId,
      },
    });
    expect(send.statusCode).toBe(400);
    expect(send.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('updating a published template clones it as next draft version', async () => {
    const u = await signupOwner('o7@example.com');
    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };

    const v1 = await app.inject({
      method: 'POST',
      url: '/api/v1/email-templates',
      headers,
      payload: { name: 'T', subject: 'V1', htmlBody: '<p>v1</p>', publish: true },
    });
    const id = v1.json().template.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/email-templates/${id}`,
      headers,
      payload: { subject: 'V2', publish: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().template.version).toBe(2);
    expect(updated.json().template.status).toBe('published');
    expect(updated.json().template.id).not.toBe(id);
  });

  // ─── 6. RBAC ─────────────────────────────────────────────────────────────

  it('viewer cannot send (403 PERMISSION_DENIED) but can read', async () => {
    const owner = await signupOwner('owner-rbac@example.com');
    const viewer = await signupOwner('viewer-rbac@example.com');
    await seedVerifiedDomain(owner.workspace.id, 'acme.com');

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
      url: '/api/v1/emails/send',
      headers: {
        authorization: `Bearer ${viewer.tokens.accessToken}`,
        'x-workspace-id': owner.workspace.id,
      },
      payload: {
        to: [{ email: 'a@b.com' }],
        from: { email: 'h@acme.com' },
        subject: 'X',
        html: '<p>x</p>',
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/emails',
      headers: {
        authorization: `Bearer ${viewer.tokens.accessToken}`,
        'x-workspace-id': owner.workspace.id,
      },
    });
    expect(list.statusCode).toBe(200);
  });

  // ─── 7. Queue publish failure rollback ───────────────────────────────────

  it('queue publish failure rolls back the DB row', async () => {
    const u = await signupOwner('o8@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');

    const original = app.nats.publish.bind(app.nats);
    app.nats.publish = (() => {
      throw new Error('NATS down');
    }) as typeof app.nats.publish;

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/emails/send',
        headers: {
          authorization: `Bearer ${u.tokens.accessToken}`,
          'x-workspace-id': u.workspace.id,
        },
        payload: {
          to: [{ email: 'a@b.com' }],
          from: { email: 'h@acme.com' },
          subject: 'X',
          html: '<p>x</p>',
        },
      });
      expect(res.statusCode).toBe(500);
    } finally {
      app.nats.publish = original;
    }

    // No row remains
    const { emailSends } = await import('@shared/database/schema/emails.js');
    const remaining = await app.db
      .select()
      .from(emailSends)
      .where(eq(emailSends.workspaceId, u.workspace.id));
    expect(remaining).toHaveLength(0);
  });

  // ─── 8. List sends ───────────────────────────────────────────────────────

  it('list sends supports status + recipient filters with pagination', async () => {
    const u = await signupOwner('o9@example.com');
    await seedVerifiedDomain(u.workspace.id, 'acme.com');
    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/emails/send',
        headers,
        payload: {
          to: [{ email: `user${i}@x.com` }],
          from: { email: 'h@acme.com' },
          subject: `S ${i}`,
          html: '<p>x</p>',
        },
      });
    }

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?status=queued&pageSize=3',
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(5);
    expect(list.json().items).toHaveLength(3);

    const search = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?recipient=user2',
      headers,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().total).toBe(1);
    expect(search.json().items[0].recipientEmail).toBe('user2@x.com');
  });

  // suppress unused import warning
  void vi;
});
