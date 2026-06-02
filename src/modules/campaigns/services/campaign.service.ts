import { Counter } from 'prom-client';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import {
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from '@shared/errors/app-errors.js';
import { domains as domainsTable } from '@shared/database/schema/domains.js';
import {
  CAMPAIGN_STATUS,
  type Campaign,
  type CampaignStatus,
  type CampaignType,
} from '@shared/database/schema/campaigns.js';
import type { Database } from '@shared/database/client.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { AuthenticatedUser } from '@shared/types/index.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { CampaignRepository } from '../repositories/campaign.repository.js';
import type {
  CreateCampaignBody,
  ListCampaignsQuery,
  UpdateCampaignBody,
} from '../schemas/campaign.schema.js';

// ─── Metrics ─────────────────────────────────────────────────────────────────

const campaignsCreatedTotal = new Counter({
  name: 'campaigns_created_total',
  help: 'Campaigns created',
  labelNames: ['type'] as const,
});
const campaignsScheduledTotal = new Counter({
  name: 'campaigns_scheduled_total',
  help: 'Campaigns transitioned to scheduled',
});
const campaignsSentTriggers = new Counter({
  name: 'campaigns_send_triggers_total',
  help: 'Campaign send triggers (sending state entered)',
  labelNames: ['outcome'] as const, // queued | rollback | empty_audience
});
const campaignsTransitionFailures = new Counter({
  name: 'campaigns_transition_failures_total',
  help: 'Campaign state transition rejections',
  labelNames: ['from', 'to'] as const,
});

// ─── Public types ────────────────────────────────────────────────────────────

export interface ActorContext {
  user: AuthenticatedUser;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface SendCampaignResult {
  campaignId: string;
  status: 'sending';
  recipientCount: number;
}

/** Locked queue contract — DO NOT change shape. */
interface CampaignQueuePayload {
  jobId: string;
  workspaceId: string;
  campaignId: string;
  segmentId: string;
  sender: { email: string; name?: string };
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
}

// ─── State machine ───────────────────────────────────────────────────────────

const ALLOWED_EDIT_STATUSES = ['draft'] as const satisfies readonly CampaignStatus[];
/** Non-content fields editable on a scheduled campaign (e.g. reschedule). */
const ALLOWED_EDIT_STATUSES_RESTRICTED = [
  'draft',
  'scheduled',
] as const satisfies readonly CampaignStatus[];

// ─── Service ─────────────────────────────────────────────────────────────────

export class CampaignService {
  public constructor(
    private readonly db: Database,
    private readonly repo: CampaignRepository,
    private readonly nats: NatsClient,
    private readonly audit: AuditService,
    private readonly logger: {
      info: (...a: unknown[]) => void;
      warn: (...a: unknown[]) => void;
      error: (...a: unknown[]) => void;
    },
  ) {}

  // ─── 1. Create ─────────────────────────────────────────────────────────────

  public async createCampaign(
    workspaceId: string,
    body: CreateCampaignBody,
    actor: ActorContext,
  ): Promise<Campaign> {
    const dup = await this.repo.findByName(workspaceId, body.name.trim());
    if (dup) {
      throw new ConflictError('Campaign name already exists', 'CAMPAIGN_NAME_TAKEN');
    }

    if (body.from?.email) {
      await this.assertSenderDomainVerified(workspaceId, body.from.email);
    }
    if (body.segmentId) {
      await this.assertSegmentInWorkspace(workspaceId, body.segmentId);
    }

    const created = await this.db.transaction(async (tx) => {
      return this.repo.insert(tx, {
        workspaceId,
        name: body.name.trim(),
        type: (body.type as CampaignType | undefined) ?? 'regular',
        status: 'draft',
        subject: body.subject ?? null,
        previewText: body.previewText ?? null,
        senderEmail: body.from?.email ?? null,
        senderName: body.from?.name ?? null,
        replyTo: body.replyTo ?? null,
        htmlBody: body.html ?? null,
        textBody: body.text ?? null,
        templateId: body.templateId ?? null,
        segmentId: body.segmentId ?? null,
        createdBy: actor.user.id,
      });
    });

    campaignsCreatedTotal.inc({ type: created.type });

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'campaign',
      targetId: created.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'campaign.created', name: created.name, type: created.type },
    });

    this.logger.info({ workspaceId, campaignId: created.id }, '[campaigns] created');
    return created;
  }

  // ─── 2. Update ─────────────────────────────────────────────────────────────

  public async updateCampaign(
    workspaceId: string,
    campaignId: string,
    body: UpdateCampaignBody,
    actor: ActorContext,
  ): Promise<Campaign> {
    const existing = await this.repo.findById(workspaceId, campaignId);
    if (!existing) {
      throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }

    // Sent / failed / cancelled / sending campaigns are immutable.
    if (
      existing.status === 'sent' ||
      existing.status === 'failed' ||
      existing.status === 'cancelled' ||
      existing.status === 'sending' ||
      existing.status === 'paused'
    ) {
      throw new ForbiddenError(
        `Cannot edit a ${existing.status} campaign`,
        'INVALID_CAMPAIGN_STATE',
      );
    }

    // Determine which fields are being changed and which states allow them.
    // Content edits (html/text/template/sender/subject/segment) only on draft.
    const isContentChange =
      body.subject !== undefined ||
      body.previewText !== undefined ||
      body.from !== undefined ||
      body.replyTo !== undefined ||
      body.html !== undefined ||
      body.text !== undefined ||
      body.templateId !== undefined ||
      body.segmentId !== undefined;

    const allowedStatuses: readonly CampaignStatus[] =
      isContentChange ? ALLOWED_EDIT_STATUSES : ALLOWED_EDIT_STATUSES_RESTRICTED;

    if (!allowedStatuses.includes(existing.status as CampaignStatus)) {
      throw new ForbiddenError(
        `Cannot make this change while campaign is ${existing.status}`,
        'INVALID_CAMPAIGN_STATE',
      );
    }

    // Side validations
    if (body.from?.email) {
      await this.assertSenderDomainVerified(workspaceId, body.from.email);
    }
    if (body.segmentId) {
      await this.assertSegmentInWorkspace(workspaceId, body.segmentId);
    }
    if (body.name && body.name.trim() !== existing.name) {
      const dup = await this.repo.findByName(workspaceId, body.name.trim());
      if (dup && dup.id !== existing.id) {
        throw new ConflictError('Campaign name already exists', 'CAMPAIGN_NAME_TAKEN');
      }
    }

    const patch: Parameters<CampaignRepository['updateContent']>[4] = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.subject !== undefined) patch.subject = body.subject;
    if (body.previewText !== undefined) patch.previewText = body.previewText;
    if (body.from !== undefined) {
      patch.senderEmail = body.from.email;
      patch.senderName = body.from.name ?? null;
    }
    if (body.replyTo !== undefined) patch.replyTo = body.replyTo ?? null;
    if (body.html !== undefined) patch.htmlBody = body.html ?? null;
    if (body.text !== undefined) patch.textBody = body.text ?? null;
    if (body.templateId !== undefined) patch.templateId = body.templateId ?? null;
    if (body.segmentId !== undefined) patch.segmentId = body.segmentId ?? null;

    const updated = await this.repo.updateContent(
      workspaceId,
      campaignId,
      body.version,
      allowedStatuses,
      patch,
    );
    if (!updated) {
      throw new ConflictError(
        'Campaign was modified by another request — please retry',
        'VERSION_CONFLICT',
      );
    }

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'campaign',
      targetId: updated.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'campaign.updated',
        changedFields: Object.keys(patch),
        prevVersion: body.version,
      },
    });

    return updated;
  }

  // ─── 3. List ───────────────────────────────────────────────────────────────

  public async listCampaigns(
    workspaceId: string,
    query: ListCampaignsQuery,
  ): Promise<{ items: Campaign[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const result = await this.repo.list({
      workspaceId,
      status: query.status as CampaignStatus | undefined,
      type: query.type as CampaignType | undefined,
      search: query.search,
      fromDate: query.fromDate,
      toDate: query.toDate,
      page,
      pageSize,
    });
    return { ...result, page, pageSize };
  }

  // ─── 4. Get ────────────────────────────────────────────────────────────────

  public async getCampaign(workspaceId: string, campaignId: string): Promise<Campaign> {
    const row = await this.repo.findById(workspaceId, campaignId);
    if (!row) {
      throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }
    return row;
  }

  // ─── 5. Schedule ───────────────────────────────────────────────────────────

  public async scheduleCampaign(
    workspaceId: string,
    campaignId: string,
    scheduledAt: Date,
    actor: ActorContext,
  ): Promise<Campaign> {
    if (scheduledAt.getTime() <= Date.now()) {
      throw new ValidationError('scheduledAt must be in the future', {
        field: 'scheduledAt',
      });
    }
    // Cap to 1 year ahead — defends against accidental ten-year-out schedules.
    const oneYear = Date.now() + 365 * 24 * 60 * 60 * 1000;
    if (scheduledAt.getTime() > oneYear) {
      throw new ValidationError('scheduledAt cannot be more than 1 year ahead');
    }

    const existing = await this.repo.findById(workspaceId, campaignId);
    if (!existing) {
      throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }
    this.assertSendable(existing);

    const updated = await this.repo.transitionStatus(
      workspaceId,
      campaignId,
      ['draft'] as const,
      'scheduled',
      { scheduledAt },
    );
    if (!updated) {
      campaignsTransitionFailures.inc({ from: existing.status, to: 'scheduled' });
      throw new ForbiddenError(
        `Cannot schedule a ${existing.status} campaign`,
        'INVALID_CAMPAIGN_STATE',
      );
    }

    campaignsScheduledTotal.inc();
    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'campaign',
      targetId: campaignId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'campaign.scheduled', scheduledAt: scheduledAt.toISOString() },
    });

    this.logger.info(
      { workspaceId, campaignId, scheduledAt: scheduledAt.toISOString() },
      '[campaigns] scheduled',
    );
    return updated;
  }

  // ─── 6. Send now ───────────────────────────────────────────────────────────

  public async sendCampaign(
    workspaceId: string,
    campaignId: string,
    actor: ActorContext,
  ): Promise<SendCampaignResult> {
    const existing = await this.repo.findById(workspaceId, campaignId);
    if (!existing) {
      throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }
    this.assertSendable(existing);

    // Empty-audience guard via segment estimatedCount
    if (!existing.segmentId) {
      throw new ValidationError('Campaign has no segment assigned', {
        code: 'INVALID_SEGMENT',
      });
    }
    const segment = await this.repo.findSegment(workspaceId, existing.segmentId);
    if (!segment) {
      throw new ForbiddenError('Segment not found in this workspace', 'INVALID_SEGMENT');
    }
    if (segment.contactCount <= 0) {
      campaignsSentTriggers.inc({ outcome: 'empty_audience' });
      throw new ValidationError('Segment audience is empty — refresh segment before sending', {
        code: 'EMPTY_SEGMENT',
      });
    }

    if (!existing.senderEmail) {
      throw new ValidationError('Campaign has no sender email');
    }
    await this.assertSenderDomainVerified(workspaceId, existing.senderEmail);

    if (!existing.subject || (!existing.htmlBody && !existing.textBody && !existing.templateId)) {
      throw new ValidationError('Campaign is missing subject or body');
    }

    // Atomic transition draft|scheduled|paused → sending; only one caller wins.
    const transitioning = await this.repo.transitionStatusWithVersion(
      workspaceId,
      campaignId,
      existing.version,
      ['draft', 'scheduled', 'paused'] as const,
      'sending',
      {
        startedAt: new Date(),
        recipientCount: segment.contactCount,
      },
    );
    if (!transitioning) {
      campaignsTransitionFailures.inc({ from: existing.status, to: 'sending' });
      throw new ConflictError(
        `Cannot send a ${existing.status} campaign — it may have changed; refetch and retry`,
        'INVALID_CAMPAIGN_STATE',
      );
    }

    // Build the LOCKED queue payload
    const payload: CampaignQueuePayload = {
      jobId: randomUUID(),
      workspaceId,
      campaignId,
      segmentId: segment.id,
      sender: {
        email: transitioning.senderEmail!,
        ...(transitioning.senderName ? { name: transitioning.senderName } : {}),
      },
      ...(transitioning.replyTo ? { replyTo: transitioning.replyTo } : {}),
      subject: transitioning.subject!,
      ...(transitioning.htmlBody ? { html: transitioning.htmlBody } : {}),
      ...(transitioning.textBody ? { text: transitioning.textBody } : {}),
    };

    try {
      await this.nats.publish(NATS_SUBJECTS.CAMPAIGN_SEND_START, payload);
    } catch (err) {
      // Roll back the status to its previous value to keep the user able to retry.
      this.logger.error(
        { err, workspaceId, campaignId },
        '[campaigns] queue publish failed; rolling back to previous status',
      );
      const restored = await this.repo.transitionStatus(
        workspaceId,
        campaignId,
        ['sending'] as const,
        existing.status as CampaignStatus,
      );
      if (!restored) {
        // Truly unexpected — log loudly and bail.
        this.logger.error(
          { workspaceId, campaignId, prevStatus: existing.status },
          '[campaigns] rollback transition failed',
        );
      }
      campaignsSentTriggers.inc({ outcome: 'rollback' });
      throw new InternalServerError(
        'Failed to enqueue campaign send',
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    campaignsSentTriggers.inc({ outcome: 'queued' });
    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'campaign',
      targetId: campaignId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'campaign.send.triggered',
        recipientCount: segment.contactCount,
        prevStatus: existing.status,
      },
    });

    this.logger.info(
      { workspaceId, campaignId, recipientCount: segment.contactCount },
      '[campaigns] send triggered',
    );

    return {
      campaignId,
      status: 'sending',
      recipientCount: segment.contactCount,
    };
  }

  // ─── 7. Pause ──────────────────────────────────────────────────────────────

  public async pauseCampaign(
    workspaceId: string,
    campaignId: string,
    actor: ActorContext,
  ): Promise<Campaign> {
    const existing = await this.repo.findById(workspaceId, campaignId);
    if (!existing) {
      throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }

    const updated = await this.repo.transitionStatus(
      workspaceId,
      campaignId,
      ['scheduled', 'sending'] as const,
      'paused',
      { pausedAt: new Date() },
    );
    if (!updated) {
      campaignsTransitionFailures.inc({ from: existing.status, to: 'paused' });
      throw new ForbiddenError(
        `Cannot pause a ${existing.status} campaign`,
        'INVALID_CAMPAIGN_STATE',
      );
    }

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'campaign',
      targetId: campaignId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'campaign.paused', prevStatus: existing.status },
    });
    return updated;
  }

  // ─── 8. Resume ─────────────────────────────────────────────────────────────

  public async resumeCampaign(
    workspaceId: string,
    campaignId: string,
    actor: ActorContext,
  ): Promise<Campaign> {
    const existing = await this.repo.findById(workspaceId, campaignId);
    if (!existing) {
      throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }

    // Resume target depends on whether it was actively sending or pre-launch.
    // We resume to 'sending' if startedAt is set, else back to 'scheduled' if a
    // scheduledAt is in the future, else 'draft'.
    let target: CampaignStatus;
    if (existing.startedAt) {
      target = 'sending';
    } else if (existing.scheduledAt && existing.scheduledAt.getTime() > Date.now()) {
      target = 'scheduled';
    } else {
      target = 'draft';
    }

    const updated = await this.repo.transitionStatus(
      workspaceId,
      campaignId,
      ['paused'] as const,
      target,
      { pausedAt: null as unknown as Date | null },
    );
    if (!updated) {
      campaignsTransitionFailures.inc({ from: existing.status, to: target });
      throw new ForbiddenError(
        `Cannot resume a ${existing.status} campaign`,
        'INVALID_CAMPAIGN_STATE',
      );
    }

    // If we resumed a 'sending' campaign, re-publish the trigger so the worker picks it up.
    if (target === 'sending' && updated.segmentId) {
      try {
        const payload: CampaignQueuePayload = {
          jobId: randomUUID(),
          workspaceId,
          campaignId,
          segmentId: updated.segmentId,
          sender: {
            email: updated.senderEmail!,
            ...(updated.senderName ? { name: updated.senderName } : {}),
          },
          ...(updated.replyTo ? { replyTo: updated.replyTo } : {}),
          subject: updated.subject!,
          ...(updated.htmlBody ? { html: updated.htmlBody } : {}),
          ...(updated.textBody ? { text: updated.textBody } : {}),
        };
        await this.nats.publish(NATS_SUBJECTS.CAMPAIGN_SEND_START, payload);
      } catch (err) {
        this.logger.warn(
          { err, workspaceId, campaignId },
          '[campaigns] resume publish failed (worker will reconcile)',
        );
      }
    }

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'campaign',
      targetId: campaignId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'campaign.resumed', resumedTo: target },
    });
    return updated;
  }

  // ─── 9. Delete ─────────────────────────────────────────────────────────────

  public async deleteCampaign(
    workspaceId: string,
    campaignId: string,
    actor: ActorContext,
  ): Promise<void> {
    const existing = await this.repo.findById(workspaceId, campaignId);
    if (!existing) {
      throw new NotFoundError('Campaign not found', 'CAMPAIGN_NOT_FOUND');
    }
    if (existing.status === 'sending') {
      throw new ForbiddenError(
        'Pause a sending campaign before deleting',
        'INVALID_CAMPAIGN_STATE',
      );
    }

    const tomb = await this.repo.softDelete(workspaceId, campaignId);
    if (!tomb) {
      throw new ConflictError('Campaign state changed during deletion', 'CONFLICT');
    }

    await this.audit.record({
      action: 'workspace.member.removed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'campaign',
      targetId: campaignId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'campaign.deleted', name: existing.name, prevStatus: existing.status },
    });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private assertSendable(c: Campaign): void {
    if (c.status === 'sent' || c.status === 'failed' || c.status === 'cancelled') {
      throw new ForbiddenError(
        `Campaign is ${c.status}`,
        'INVALID_CAMPAIGN_STATE',
      );
    }
  }

  private async assertSenderDomainVerified(
    workspaceId: string,
    senderEmail: string,
  ): Promise<void> {
    const at = senderEmail.lastIndexOf('@');
    if (at < 0 || at === senderEmail.length - 1) {
      throw new ValidationError('Invalid sender email');
    }
    const host = senderEmail.slice(at + 1).toLowerCase();
    const rows = await this.db
      .select({ id: domainsTable.id })
      .from(domainsTable)
      .where(
        and(
          eq(domainsTable.workspaceId, workspaceId),
          eq(domainsTable.domain, host),
          eq(domainsTable.status, 'verified'),
          isNull(domainsTable.deletedAt),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      throw new ForbiddenError(
        `Sender domain '${host}' is not verified for this workspace`,
        'SENDER_DOMAIN_NOT_VERIFIED',
      );
    }
  }

  private async assertSegmentInWorkspace(
    workspaceId: string,
    segmentId: string,
  ): Promise<void> {
    const seg = await this.repo.findSegment(workspaceId, segmentId);
    if (!seg) {
      throw new ForbiddenError(
        'Segment does not exist in this workspace',
        'INVALID_SEGMENT',
      );
    }
  }
}

// silence unused
void CAMPAIGN_STATUS;
