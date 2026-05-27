import { describe, expect, it, beforeEach, vi } from 'vitest';
import { DomainService } from '@modules/domains/services/domain.service.js';
import { DomainRepository } from '@modules/domains/repositories/domain.repository.js';
import type { SesIdentityClient } from '@shared/email/ses-identity.js';
import type { Database } from '@shared/database/client.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeSesMock(opts: Partial<SesIdentityClient> = {}): SesIdentityClient {
  return {
    createDomainIdentity: vi.fn(async () => ({
      identityArn: 'arn:aws:ses:us-east-1:123:identity/acme.com',
      dkimTokens: ['tok1', 'tok2', 'tok3'],
      verificationStatus: 'PENDING',
      dkimStatus: 'PENDING',
    })),
    getIdentity: vi.fn(async () => ({
      exists: false,
      dkimTokens: [],
    })),
    deleteIdentity: vi.fn(async () => undefined),
    enableEasyDkim: vi.fn(async () => undefined),
    ...opts,
  };
}

function makeNatsMock(): NatsClient & { calls: Array<{ subject: string; payload: unknown }> } {
  const calls: Array<{ subject: string; payload: unknown }> = [];
  return {
    publish: vi.fn((subject: string, payload: unknown) => {
      calls.push({ subject, payload });
    }),
    request: vi.fn(async () => ({})) as never,
    close: vi.fn(async () => undefined) as never,
    connection: {} as never,
    calls,
  };
}

function makeAuditMock(): AuditService {
  return { record: vi.fn(async () => undefined) } as unknown as AuditService;
}

// We don't need a real DB for service unit tests — only DnsRecords path.
const fakeDb = {} as unknown as Database;
const fakeRepo = {} as unknown as DomainRepository;

describe('DomainService.buildDnsRecords', () => {
  const svc = new DomainService(
    fakeDb,
    fakeRepo,
    makeSesMock(),
    makeAuditMock(),
    makeNatsMock(),
    noopLogger,
  );

  it('produces SPF, DKIM CNAMEs, and DMARC', () => {
    const dns = svc.buildDnsRecords('acme.com', ['t1', 't2', 't3']);

    expect(dns.spf).toEqual({
      type: 'TXT',
      host: '@',
      value: 'v=spf1 include:amazonses.com ~all',
    });

    expect(dns.dkim).toHaveLength(3);
    expect(dns.dkim[0]).toEqual({
      type: 'CNAME',
      host: 't1._domainkey.acme.com',
      value: 't1.dkim.amazonses.com',
    });

    expect(dns.dmarc.type).toBe('TXT');
    expect(dns.dmarc.host).toBe('_dmarc.acme.com');
    expect(dns.dmarc.value).toContain('v=DMARC1');
    expect(dns.dmarc.value).toContain('p=none'); // monitoring mode
  });

  it('returns zero DKIM records when SES has not provisioned tokens yet', () => {
    const dns = svc.buildDnsRecords('acme.com', []);
    expect(dns.dkim).toEqual([]);
    expect(dns.spf.value).toBeTruthy();
    expect(dns.dmarc.value).toBeTruthy();
  });
});

describe('DomainService.createDomain — SES failure rollback', () => {
  let repoCalls: { method: string; args: unknown[] }[] = [];
  const trackingRepo = {
    findByDomain: vi.fn(async () => null),
    insert: vi.fn(async (_tx: unknown, values: unknown) => {
      repoCalls.push({ method: 'insert', args: [values] });
      return {
        id: 'd1',
        workspaceId: 'w1',
        domain: 'acme.com',
        sesIdentity: 'acme.com',
        sesIdentityArn: null,
        status: 'pending',
        dkimTokens: [],
        verificationStartedAt: new Date(),
        verifiedAt: null,
        lastVerificationCheckAt: null,
        verificationAttempts: 0,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
    }),
    deleteByIdTx: vi.fn(async (_tx: unknown, ws: string, id: string) => {
      repoCalls.push({ method: 'deleteByIdTx', args: [ws, id] });
    }),
    updateWithVersion: vi.fn(),
  } as unknown as DomainRepository;

  // Fake DB whose .transaction simply executes the callback inline with a noop tx.
  const txDb = {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
  } as unknown as Database;

  beforeEach(() => {
    repoCalls = [];
    vi.clearAllMocks();
  });

  it('rolls back DB row when SES createDomainIdentity throws', async () => {
    const ses = makeSesMock({
      createDomainIdentity: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const nats = makeNatsMock();
    const svc = new DomainService(txDb, trackingRepo, ses, makeAuditMock(), nats, noopLogger);

    await expect(
      svc.createDomain('w1', 'acme.com', {
        user: { id: 'u1', email: 'a@b.c', isEmailVerified: true, isActive: true },
      }),
    ).rejects.toThrowError(/Failed to provision SES domain identity/);

    // The DB row insert happened, then the rollback delete was executed.
    expect(repoCalls.find((c) => c.method === 'insert')).toBeDefined();
    expect(repoCalls.find((c) => c.method === 'deleteByIdTx')).toBeDefined();
    // Best-effort SES delete was attempted (rolling back any partial provision).
    expect(ses.deleteIdentity).toHaveBeenCalledWith('acme.com');
    // No NATS publish on failure.
    expect(nats.calls).toHaveLength(0);
  });
});
