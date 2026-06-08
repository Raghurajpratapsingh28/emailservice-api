import type { FastifyBaseLogger } from 'fastify';
import { ForbiddenError, NotFoundError, ValidationError } from '@shared/errors/app-errors.js';
import type { Paginated } from '@shared/types/index.js';
import type { Segment } from '@shared/database/schema/segments.js';
import type { Contact } from '@shared/database/schema/contacts.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { BillingService } from '@modules/billing/services/billing.service.js';
import { resourceLimitsForPlan } from '@constants/plan-limits.js';
import type { SegmentRepository } from '../repositories/segment.repository.js';
import type { CreateSegmentBody, ListSegmentsQuery, UpdateSegmentBody } from '../schemas/segment.schema.js';
import {
  segmentRefreshQueued,
  segmentsCreated,
  segmentsUpdated,
} from '@observability/contacts-metrics.js';

export interface ActorContext {
  user: { id: string };
  ipAddress?: string;
  userAgent?: string;
}

/** Locked NATS subject contract for segment refresh. */
const SEGMENT_REFRESH_SUBJECT = 'segment.refresh';

export interface SegmentRefreshPayload {
  workspaceId: string;
  segmentId: string;
}

export class SegmentService {
  public constructor(
    private readonly repo: SegmentRepository,
    private readonly nats: NatsClient,
    private readonly audit: AuditService,
    private readonly log: FastifyBaseLogger,
    private readonly billing: BillingService,
  ) {}

  public async createSegment(
    workspaceId: string,
    body: CreateSegmentBody,
    actor: ActorContext,
  ): Promise<Segment> {
    if (body.type === 'dynamic' && !body.filterTree) {
      throw new ValidationError('filterTree is required for dynamic segments', {
        field: 'filterTree',
      });
    }

    const sub = await this.billing.getSubscription(workspaceId);
    const limits = resourceLimitsForPlan(sub.plan);
    if (Number.isFinite(limits.maxSegments)) {
      const segmentCount = await this.repo.countByWorkspace(workspaceId);
      if (segmentCount >= limits.maxSegments) {
        throw new ForbiddenError(
          `Segment limit (${limits.maxSegments}) reached for your plan`,
          'QUOTA_EXCEEDED',
        );
      }
    }

    const isStatic = (body.type ?? 'static') === 'static';

    const segment = await this.repo.insert({
      workspaceId,
      name: body.name,
      type: body.type ?? 'static',
      filterTree: (body.filterTree ?? {}) as Record<string, unknown>,
      status: isStatic ? 'ready' : 'pending',
      lastComputed: isStatic ? new Date() : undefined,
      createdBy: actor.user.id,
    });

    segmentsCreated.inc({ workspace_id: workspaceId, type: segment.type });
    this.log.info({ segmentId: segment.id, workspaceId, type: segment.type }, 'segment created');

    if (!isStatic) this.enqueueRefresh(workspaceId, segment.id);

    await this.audit.record({
      action: 'segment.created',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'segment',
      targetId: segment.id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return segment;
  }

  public async updateSegment(
    workspaceId: string,
    id: string,
    body: UpdateSegmentBody,
    actor: ActorContext,
  ): Promise<Segment> {
    const existing = await this.repo.findById(workspaceId, id);
    if (!existing) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');

    const patch: Partial<Segment> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.type !== undefined) patch.type = body.type;
    if (body.filterTree !== undefined) patch.filterTree = body.filterTree as Record<string, unknown>;

    const effectiveType = patch.type ?? existing.type;
    const isStatic = effectiveType === 'static';

    const updated = await this.repo.update(workspaceId, id, {
      ...patch,
      status: isStatic ? 'ready' : 'pending',
    });
    if (!updated) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');

    segmentsUpdated.inc({ workspace_id: workspaceId });
    this.log.info({ segmentId: id, workspaceId }, 'segment updated');

    if (!isStatic) this.enqueueRefresh(workspaceId, id);

    await this.audit.record({
      action: 'segment.updated',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'segment',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return updated;
  }

  public async getSegment(workspaceId: string, id: string): Promise<Segment> {
    const segment = await this.repo.findById(workspaceId, id);
    if (!segment) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');
    return segment;
  }

  public async listSegments(
    workspaceId: string,
    query: ListSegmentsQuery,
  ): Promise<Paginated<Segment>> {
    const { items, total } = await this.repo.list(workspaceId, query.page, query.pageSize);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  public async deleteSegment(
    workspaceId: string,
    id: string,
    actor: ActorContext,
  ): Promise<void> {
    const deleted = await this.repo.softDelete(workspaceId, id);
    if (!deleted) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');

    this.log.info({ segmentId: id, workspaceId }, 'segment deleted');
    await this.audit.record({
      action: 'segment.deleted',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'segment',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);
  }

  public async refreshSegment(
    workspaceId: string,
    id: string,
    _actor: ActorContext,
  ): Promise<{ queued: true }> {
    const segment = await this.repo.findById(workspaceId, id);
    if (!segment) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');

    await this.repo.update(workspaceId, id, { status: 'pending' });
    this.enqueueRefresh(workspaceId, id);

    this.log.info({ segmentId: id, workspaceId }, 'segment refresh queued');
    return { queued: true };
  }

  public async previewSegment(
    workspaceId: string,
    id: string,
    limit: number,
  ): Promise<{ contacts: Contact[]; total: number }> {
    const segment = await this.repo.findById(workspaceId, id);
    if (!segment) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');

    const rows = await this.repo.getPreviewContacts(workspaceId, id, limit);
    return {
      contacts: rows.map((r) => r.contact),
      total: segment.contactCount,
    };
  }

  public async addContactToSegment(
    workspaceId: string,
    segmentId: string,
    contactId: string,
    actor: ActorContext,
  ): Promise<void> {
    const segment = await this.repo.findById(workspaceId, segmentId);
    if (!segment) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');
    if (segment.type !== 'static') {
      throw new ValidationError('Cannot manually add contacts to a dynamic segment', { field: 'segmentId' });
    }

    await this.repo.addMember(workspaceId, segmentId, contactId);

    const newCount = await this.repo.getMembershipCount(segmentId);
    await this.repo.update(workspaceId, segmentId, { contactCount: newCount, status: 'ready', lastComputed: new Date() });

    this.log.info({ segmentId, contactId, workspaceId }, 'contact added to static segment');
    await this.audit.record({
      action: 'segment.contact_added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'segment',
      targetId: segmentId,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);
  }

  public async removeContactFromSegment(
    workspaceId: string,
    segmentId: string,
    contactId: string,
    actor: ActorContext,
  ): Promise<void> {
    const segment = await this.repo.findById(workspaceId, segmentId);
    if (!segment) throw new NotFoundError('Segment not found', 'SEGMENT_NOT_FOUND');
    if (segment.type !== 'static') {
      throw new ValidationError('Cannot manually remove contacts from a dynamic segment', { field: 'segmentId' });
    }

    await this.repo.removeMember(workspaceId, segmentId, contactId);

    const newCount = await this.repo.getMembershipCount(segmentId);
    await this.repo.update(workspaceId, segmentId, { contactCount: newCount });

    this.log.info({ segmentId, contactId, workspaceId }, 'contact removed from static segment');
    await this.audit.record({
      action: 'segment.contact_removed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'segment',
      targetId: segmentId,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);
  }

  private enqueueRefresh(workspaceId: string, segmentId: string): void {
    const payload: SegmentRefreshPayload = { workspaceId, segmentId };
    try {
      this.nats.publish<SegmentRefreshPayload>(SEGMENT_REFRESH_SUBJECT, payload);
      segmentRefreshQueued.inc({ workspace_id: workspaceId });
      this.log.info({ segmentId, workspaceId }, 'segment.refresh enqueued');
    } catch (err) {
      this.log.error({ err, segmentId, workspaceId }, 'failed to enqueue segment.refresh');
    }
  }
}
