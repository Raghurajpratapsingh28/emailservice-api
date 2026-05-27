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

/**
 * Domains module integration tests.
 *
 * The SES client is stubbed via app.services.domains private field swap so we
 * never hit AWS during tests. The stub records calls and yields deterministic
 * DKIM tokens.
 */
describeIfInfra('domains — integration', () => {
  let app: FastifyInstance;

  // Mutable stub recorder reset between tests
  const sesStub = {
    create: vi.fn(),
    delete: vi.fn(),
    enableDkim: vi.fn(),
    get: vi.fn(),
  };

  function installSesStub(): void {
    const ses = {
      createDomainIdentity: sesStub.create,
      deleteIdentity: sesStub.delete,
      enableEasyDkim: sesStub.enableDkim,
      getIdentity: sesStub.get,
    };
    // Replace the private SES client on the live DomainService instance.
    (app.services.domains as unknown as { ses: typeof ses }).ses = ses;
  }

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
    sesStub.create.mockReset();
    sesStub.delete.mockReset();
    sesStub.enableDkim.mockReset();
    sesStub.get.mockReset();
    installSesStub();

    sesStub.create.mockResolvedValue({
      identityArn: 'arn:aws:ses:us-east-1:000000000000:identity/example',
      dkimTokens: ['t1', 't2', 't3'],
      verificationStatus: 'PENDING',
      dkimStatus: 'PENDING',
    });
    sesStub.delete.mockResolvedValue(undefined);
    sesStub.enableDkim.mockResolvedValue(undefined);
    sesStub.get.mockResolvedValue({ exists: false, dkimTokens: [] });
  });

  async function signupOwner(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password: 'GoodPass!2345A', firstName: 'O', lastName: 'X' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      user: { id: string; email: string };
      workspace: { id: string };
      tokens: { accessToken: string; refreshToken: string };
    };
  }

  it('1. POST /domains creates a domain, returns DKIM/SPF/DMARC, and queues a verify poll', async () => {
    const u = await signupOwner('o1@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: {
        authorization: `Bearer ${u.tokens.accessToken}`,
        'x-workspace-id': u.workspace.id,
      },
      payload: { domain: 'acme.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.domain).toBe('acme.com');
    expect(body.status).toBe('verifying');
    expect(body.dkimTokens).toEqual(['t1', 't2', 't3']);

    expect(body.dns.spf.value).toBe('v=spf1 include:amazonses.com ~all');
    expect(body.dns.dkim).toHaveLength(3);
    expect(body.dns.dkim[0]).toMatchObject({
      type: 'CNAME',
      host: 't1._domainkey.acme.com',
      value: 't1.dkim.amazonses.com',
    });
    expect(body.dns.dmarc.host).toBe('_dmarc.acme.com');

    expect(sesStub.create).toHaveBeenCalledWith('acme.com');
  });

  it('2. duplicate domain in same workspace → 409 DOMAIN_ALREADY_EXISTS', async () => {
    const u = await signupOwner('o2@example.com');
    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };

    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers,
      payload: { domain: 'acme.com' },
    });
    expect(r1.statusCode).toBe(201);

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers,
      payload: { domain: 'acme.com' },
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe('DOMAIN_ALREADY_EXISTS');
  });

  it('3. invalid domain → 400 VALIDATION_ERROR', async () => {
    const u = await signupOwner('o3@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: {
        authorization: `Bearer ${u.tokens.accessToken}`,
        'x-workspace-id': u.workspace.id,
      },
      payload: { domain: 'localhost' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('4. tenant isolation — user from workspace A cannot read workspace B domain', async () => {
    const a = await signupOwner('a@example.com');
    const b = await signupOwner('b@example.com');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: {
        authorization: `Bearer ${a.tokens.accessToken}`,
        'x-workspace-id': a.workspace.id,
      },
      payload: { domain: 'tenanta.com' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    // B tries to read A's domain by id. We send WS=B.
    const tryRead = await app.inject({
      method: 'GET',
      url: `/api/v1/domains/${id}`,
      headers: {
        authorization: `Bearer ${b.tokens.accessToken}`,
        'x-workspace-id': b.workspace.id,
      },
    });
    // Repo filters by (id, workspaceId) → 404 (not 403; we intentionally
    // don't reveal cross-tenant existence).
    expect(tryRead.statusCode).toBe(404);
    expect(tryRead.json().error.code).toBe('DOMAIN_NOT_FOUND');

    // B tries to read A's domain pointing the path id at A but using B's bearer
    // and B's x-workspace-id (forged). workspaceGuard blocks because B is not
    // a member of A's workspace... actually B can supply their own ws header,
    // so the lookup happens within B's workspace and won't find the row.
    const forged = await app.inject({
      method: 'GET',
      url: `/api/v1/domains/${id}`,
      headers: {
        authorization: `Bearer ${b.tokens.accessToken}`,
        'x-workspace-id': a.workspace.id, // B is not a member of A → guard rejects
      },
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json().error.code).toBe('WORKSPACE_ACCESS_DENIED');
  });

  it('5. POST /:id/verify requeues, DELETE /:id soft-deletes', async () => {
    const u = await signupOwner('o5@example.com');
    const headers = {
      authorization: `Bearer ${u.tokens.accessToken}`,
      'x-workspace-id': u.workspace.id,
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers,
      payload: { domain: 'acme.com' },
    });
    const id = created.json().id;

    const reverify = await app.inject({
      method: 'POST',
      url: `/api/v1/domains/${id}/verify`,
      headers,
    });
    expect(reverify.statusCode).toBe(202);
    expect(reverify.json().status).toBe('verifying');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/domains/${id}`,
      headers,
    });
    expect(del.statusCode).toBe(204);
    expect(sesStub.delete).toHaveBeenCalledWith('acme.com');

    // After delete, GET returns 404 (soft-deleted, excluded from queries)
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/domains/${id}`,
      headers,
    });
    expect(after.statusCode).toBe(404);
  });

  it('6. SES failure on create rolls back the DB row', async () => {
    const u = await signupOwner('o6@example.com');
    sesStub.create.mockRejectedValueOnce(new Error('SES outage'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: {
        authorization: `Bearer ${u.tokens.accessToken}`,
        'x-workspace-id': u.workspace.id,
      },
      payload: { domain: 'acme.com' },
    });
    expect(res.statusCode).toBe(500);

    // No row remains for that domain — retrying should succeed (no UNIQUE conflict).
    sesStub.create.mockResolvedValueOnce({
      identityArn: undefined,
      dkimTokens: ['x', 'y', 'z'],
      verificationStatus: 'PENDING',
      dkimStatus: 'PENDING',
    });
    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: {
        authorization: `Bearer ${u.tokens.accessToken}`,
        'x-workspace-id': u.workspace.id,
      },
      payload: { domain: 'acme.com' },
    });
    expect(retry.statusCode).toBe(201);
  });

  it('7. RBAC — viewer-only role gets 403 on POST /domains', async () => {
    // Owner signs up + invites a viewer; viewer accepts (this requires a
    // verified flow). To keep the test simple, we directly downgrade by
    // patching workspace_members to viewer for a second user.
    const owner = await signupOwner('owner7@example.com');
    const viewer = await signupOwner('viewer7@example.com'); // creates own workspace

    // Add viewer as a member of owner's workspace via DB
    const { roles, workspaceMembers } = await import('@shared/database/schema/index.js');
    const viewerRole = (
      await app.db.select().from(roles).where(eq(roles.slug, 'viewer'))
    )[0]!;
    await app.db.insert(workspaceMembers).values({
      workspaceId: owner.workspace.id,
      userId: viewer.user.id,
      roleId: viewerRole.id,
    });
    // Invalidate rbac cache
    await app.services.rbac.invalidate(owner.workspace.id, viewer.user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/domains',
      headers: {
        authorization: `Bearer ${viewer.tokens.accessToken}`,
        'x-workspace-id': owner.workspace.id,
      },
      payload: { domain: 'should-fail.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');

    // Viewer CAN list (read permission only)
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/domains',
      headers: {
        authorization: `Bearer ${viewer.tokens.accessToken}`,
        'x-workspace-id': owner.workspace.id,
      },
    });
    expect(list.statusCode).toBe(200);
  });
});
