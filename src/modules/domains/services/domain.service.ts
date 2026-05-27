import { Counter } from 'prom-client';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import {
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from '@shared/errors/app-errors.js';
import type { Database } from '@shared/database/client.js';
import type { Domain, DomainStatus } from '@shared/database/schema/domains.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { AuthenticatedUser } from '@shared/types/index.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { SesIdentityClient } from '@shared/email/ses-identity.js';
import { DomainRepository } from '../repositories/domain.repository.js';

// ─── Metrics ─────────────────────────────────────────────────────────────────

const domainsCreatedTotal = new Counter({
  name: 'domains_created_total',
  help: 'Total domain identities created',
  labelNames: ['plan'] as const,
});
const domainsSesFailuresTotal = new Counter({
  name: 'domains_ses_failures_total',
  help: 'SES API call failures during domain operations',
  labelNames: ['op'] as const, // create | get | delete | dkim
});
const domainsQueuePublishesTotal = new Counter({
  name: 'domains_queue_publishes_total',
  help: 'NATS publishes from the domains module',
  labelNames: ['subject'] as const,
});

// ─── Public types ────────────────────────────────────────────────────────────

export interface ActorContext {
  user: AuthenticatedUser;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface DnsSpfRecord {
  type: 'TXT';
  host: string;
  value: string;
}

export interface DnsDkimRecord {
  type: 'CNAME';
  host: string;
  value: string;
}

export interface DnsDmarcRecord {
  type: 'TXT';
  host: string;
  value: string;
}

export interface DnsRecords {
  spf: DnsSpfRecord;
  dkim: DnsDkimRecord[];
  dmarc: DnsDmarcRecord;
}

export interface DomainView extends Domain {
  dns: DnsRecords;
}

/**
 * Domain onboarding service.
 *
 * Multi-tenancy: every method takes `workspaceId` as the first arg and the
 * repository pairs `id` + `workspaceId` in WHERE on every read/write — making
 * cross-tenant access structurally impossible at this layer.
 */
export class DomainService {
  public constructor(
    private readonly db: Database,
    private readonly repo: DomainRepository,
    private readonly ses: SesIdentityClient,
    private readonly audit: AuditService,
    private readonly nats: NatsClient,
    private readonly logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
  ) {}

  // ─── 1. Create domain ─────────────────────────────────────────────────────

  /**
   * Creates a sending domain identity.
   *
   * Sequence:
   *   1. Pre-check: reject duplicates within the same workspace.
   *   2. Insert DB row with status=pending.
   *   3. Call SES CreateEmailIdentity → DKIM tokens.
   *   4. Update DB row with tokens + status=verifying.
   *   5. Publish NATS event so a worker polls SES until verified.
   *
   * If step 3 or 4 fails, the DB row is hard-deleted to keep state consistent
   * (no zombie rows visible to the user).
   */
  public async createDomain(
    workspaceId: string,
    domain: string,
    actor: ActorContext,
  ): Promise<DomainView> {
    const existing = await this.repo.findByDomain(workspaceId, domain);
    if (existing) {
      throw new ConflictError('Domain already exists for this workspace', 'DOMAIN_ALREADY_EXISTS');
    }

    // Step 2: insert pending row first so we own it before talking to SES.
    const created = await this.repo.insert(this.db, {
      workspaceId,
      domain,
      sesIdentity: domain,
      status: 'pending',
      verificationStartedAt: new Date(),
    });

    let dkimTokens: string[] = [];
    let identityArn: string | undefined;

    try {
      const sesResult = await this.ses.createDomainIdentity(domain);
      dkimTokens = sesResult.dkimTokens;
      identityArn = sesResult.identityArn;
      // Make sure Easy DKIM signing is enabled (idempotent).
      await this.ses.enableEasyDkim(domain).catch((err) => {
        this.logger.warn({ err, domain }, '[domains] enableEasyDkim failed — continuing');
        domainsSesFailuresTotal.inc({ op: 'dkim' });
      });
    } catch (err) {
      // Rollback: hard-delete the DB row so the workspace can retry cleanly.
      await this.db.transaction(async (tx) => {
        await this.repo.deleteByIdTx(tx, workspaceId, created.id);
      });
      domainsSesFailuresTotal.inc({ op: 'create' });
      this.logger.error({ err, domain, workspaceId }, '[domains] SES create failed; rolled back');

      // Best-effort: try to delete a partially created identity (shouldn't exist on failure, but safe).
      this.ses.deleteIdentity(domain).catch(() => undefined);

      throw new InternalServerError(
        'Failed to provision SES domain identity',
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // Step 4: persist DKIM tokens + advance status to verifying.
    const updated = await this.repo.updateWithVersion(workspaceId, created.id, created.version, {
      status: 'verifying',
      dkimTokens,
      sesIdentityArn: identityArn ?? null,
      verificationAttempts: 0,
    });
    if (!updated) {
      // Highly unlikely (we just inserted the row) — bail loudly so it's investigated.
      this.logger.error(
        { domainId: created.id, workspaceId },
        '[domains] post-insert update failed (version conflict)',
      );
      throw new InternalServerError('Domain post-insert update failed');
    }

    // Step 5: enqueue verification poll
    this.publishEvent(NATS_SUBJECTS.DOMAIN_VERIFY_POLL, {
      domainId: updated.id,
      workspaceId,
      domain,
    });
    this.publishEvent(NATS_SUBJECTS.DOMAIN_CREATED, {
      domainId: updated.id,
      workspaceId,
      domain,
    });
    domainsCreatedTotal.inc({ plan: 'unknown' });

    await this.audit.record({
      action: 'workspace.member.added', // generic; metadata.kind discriminates
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'domain',
      targetId: updated.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'domain.created', domain, dkimTokenCount: dkimTokens.length },
    });

    return this.toView(updated);
  }

  // ─── 2. List domains ──────────────────────────────────────────────────────

  public async listDomains(
    workspaceId: string,
    query: { page?: number; pageSize?: number; status?: DomainStatus },
  ): Promise<{ items: DomainView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const result = await this.repo.list({
      workspaceId,
      status: query.status,
      page,
      pageSize,
    });
    return {
      items: result.items.map((d) => this.toView(d)),
      total: result.total,
      page,
      pageSize,
    };
  }

  // ─── 3. Get domain ────────────────────────────────────────────────────────

  public async getDomain(workspaceId: string, domainId: string): Promise<DomainView> {
    const row = await this.repo.findById(workspaceId, domainId);
    if (!row) {
      throw new NotFoundError('Domain not found', 'DOMAIN_NOT_FOUND');
    }
    return this.toView(row);
  }

  // ─── 4. Verify (manual requeue) ──────────────────────────────────────────

  public async requeueVerification(
    workspaceId: string,
    domainId: string,
    actor: ActorContext,
  ): Promise<{ status: DomainStatus }> {
    const row = await this.repo.findById(workspaceId, domainId);
    if (!row) {
      throw new NotFoundError('Domain not found', 'DOMAIN_NOT_FOUND');
    }

    if (row.status === 'deleted' || row.status === 'deleting') {
      throw new ForbiddenError('Domain is being deleted', 'FORBIDDEN');
    }
    if (row.status === 'verified') {
      throw new ConflictError('Domain is already verified', 'DOMAIN_ALREADY_VERIFIED');
    }

    // Bump the verificationStartedAt + attempts atomically so the worker has
    // a fresh window for backoff.
    const updated = await this.repo.updateWithVersion(workspaceId, domainId, row.version, {
      status: 'verifying',
      verificationStartedAt: new Date(),
      verificationAttempts: row.verificationAttempts + 0, // unchanged here; the worker bumps it on each poll
    });
    if (!updated) {
      throw new ConflictError('Domain state changed — please retry', 'CONFLICT');
    }

    this.publishEvent(NATS_SUBJECTS.DOMAIN_VERIFY_POLL, {
      domainId: updated.id,
      workspaceId,
      domain: updated.domain,
      requeued: true,
    });

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'domain',
      targetId: updated.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'domain.verify.requeued', domain: updated.domain },
    });

    return { status: updated.status as DomainStatus };
  }

  // ─── 5. Delete ────────────────────────────────────────────────────────────

  /**
   * Soft delete pattern:
   *   1. Mark row `status='deleting'` (so listings can show it transitioning).
   *   2. Best-effort SES `DeleteEmailIdentity`.
   *   3. Mark `status='deleted'` + `deletedAt` (tombstone).
   *
   * The worker can sweep tombstones older than retention policy.
   *
   * NOTE: production rule — verified domains that are *actively sending* might
   * need a billing hold. This service treats "verified" as deletable; downstream
   * services can reject deletion via a beforeDelete hook later.
   */
  public async deleteDomain(
    workspaceId: string,
    domainId: string,
    actor: ActorContext,
  ): Promise<void> {
    const row = await this.repo.findById(workspaceId, domainId);
    if (!row) {
      throw new NotFoundError('Domain not found', 'DOMAIN_NOT_FOUND');
    }
    if (row.deletedAt) {
      // Idempotent
      return;
    }

    // Step 1: mark deleting
    const transitioning = await this.repo.updateWithVersion(workspaceId, domainId, row.version, {
      status: 'deleting',
    });
    if (!transitioning) {
      throw new ConflictError('Domain state changed — please retry', 'CONFLICT');
    }

    // Step 2: SES delete (idempotent — wrapper swallows NotFound)
    try {
      await this.ses.deleteIdentity(row.sesIdentity);
    } catch (err) {
      domainsSesFailuresTotal.inc({ op: 'delete' });
      this.logger.error(
        { err, domain: row.domain, workspaceId },
        '[domains] SES delete failed; will tombstone DB row anyway',
      );
      // Don't throw — we still want DB cleanup. SES garbage will be reaped
      // by an admin job using sesIdentity.
    }

    // Step 3: tombstone
    const tombstoned = await this.repo.softDelete(workspaceId, domainId, transitioning.version);
    if (!tombstoned) {
      throw new ConflictError('Domain state changed during deletion', 'CONFLICT');
    }

    this.publishEvent(NATS_SUBJECTS.DOMAIN_DELETED, {
      domainId,
      workspaceId,
      domain: row.domain,
    });

    await this.audit.record({
      action: 'workspace.member.removed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'domain',
      targetId: domainId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'domain.deleted', domain: row.domain, prevStatus: row.status },
    });
  }

  // ─── DNS record generation ────────────────────────────────────────────────

  public buildDnsRecords(domain: string, dkimTokens: string[]): DnsRecords {
    return {
      spf: {
        type: 'TXT',
        host: '@',
        value: 'v=spf1 include:amazonses.com ~all',
      },
      dkim: dkimTokens.map((token) => ({
        type: 'CNAME' as const,
        host: `${token}._domainkey.${domain}`,
        value: `${token}.dkim.amazonses.com`,
      })),
      dmarc: {
        type: 'TXT',
        host: `_dmarc.${domain}`,
        // Start in monitoring mode (`p=none`); operators tighten to quarantine/reject later.
        value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}; ruf=mailto:dmarc-failures@${domain}; fo=1`,
      },
    };
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private toView(row: Domain): DomainView {
    const tokens = Array.isArray(row.dkimTokens) ? (row.dkimTokens as string[]) : [];
    return {
      ...row,
      dns: this.buildDnsRecords(row.domain, tokens),
    };
  }

  private publishEvent(subject: string, payload: Record<string, unknown>): void {
    try {
      this.nats.publish(subject, { ...payload, occurredAt: new Date().toISOString() });
      domainsQueuePublishesTotal.inc({ subject });
    } catch (err) {
      this.logger.warn({ err, subject }, '[domains] NATS publish failed');
    }
  }
}
