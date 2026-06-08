import { describe, expect, it, vi } from 'vitest';
import { NotFoundError, ValidationError } from '@shared/errors/app-errors.js';
import { SegmentService } from '@modules/segments/services/segment.service.js';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    insert: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    getPreviewContacts: vi.fn(),
    replaceMemberships: vi.fn(),
    getMembershipCount: vi.fn(),
    getContactSegmentSummary: vi.fn(),
    countByWorkspace: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeBilling() {
  return {
    getSubscription: vi.fn().mockResolvedValue({ plan: 'pro' }),
    hasQuotaRemaining: vi.fn().mockResolvedValue(true),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  };
}

function makeNats() {
  return { publish: vi.fn(), request: vi.fn(), close: vi.fn(), connection: {} };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeLog() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const actor = { user: { id: 'user-1' }, ipAddress: '127.0.0.1' };
const workspaceId = 'ws-1';

describe('SegmentService', () => {
  describe('createSegment', () => {
    it('creates a static segment and enqueues refresh', async () => {
      const segment = { id: 'seg-1', workspaceId, name: 'All', type: 'static', status: 'pending' };
      const repo = makeRepo({ insert: vi.fn().mockResolvedValue(segment) });
      const nats = makeNats();
      const svc = new SegmentService(repo as never, nats as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      const result = await svc.createSegment(workspaceId, { name: 'All', type: 'static' }, actor);
      expect(result.id).toBe('seg-1');
      expect(nats.publish).toHaveBeenCalledWith('segment.refresh', { workspaceId, segmentId: 'seg-1' });
    });

    it('throws ValidationError when dynamic segment has no filterTree', async () => {
      const repo = makeRepo();
      const svc = new SegmentService(repo as never, makeNats() as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(
        svc.createSegment(workspaceId, { name: 'X', type: 'dynamic' }, actor),
      ).rejects.toThrow(ValidationError);
    });

    it('publishes locked NATS contract payload', async () => {
      const segment = { id: 'seg-2', workspaceId, name: 'Trial', type: 'dynamic', status: 'pending' };
      const repo = makeRepo({ insert: vi.fn().mockResolvedValue(segment) });
      const nats = makeNats();
      const svc = new SegmentService(repo as never, nats as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await svc.createSegment(workspaceId, {
        name: 'Trial',
        type: 'dynamic',
        filterTree: { operator: 'AND', rules: [{ field: 'email', operator: 'exists' }] },
      }, actor);

      expect(nats.publish).toHaveBeenCalledWith('segment.refresh', {
        workspaceId: 'ws-1',
        segmentId: 'seg-2',
      });
    });
  });

  describe('getSegment', () => {
    it('throws SEGMENT_NOT_FOUND when missing', async () => {
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
      const svc = new SegmentService(repo as never, makeNats() as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.getSegment(workspaceId, 'missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteSegment', () => {
    it('throws SEGMENT_NOT_FOUND when missing', async () => {
      const repo = makeRepo({ softDelete: vi.fn().mockResolvedValue(null) });
      const svc = new SegmentService(repo as never, makeNats() as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.deleteSegment(workspaceId, 'missing', actor)).rejects.toThrow(NotFoundError);
    });

    it('soft-deletes successfully', async () => {
      const repo = makeRepo({ softDelete: vi.fn().mockResolvedValue({ id: 'seg-1' }) });
      const svc = new SegmentService(repo as never, makeNats() as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.deleteSegment(workspaceId, 'seg-1', actor)).resolves.toBeUndefined();
    });
  });

  describe('refreshSegment', () => {
    it('enqueues refresh and returns queued:true', async () => {
      const segment = { id: 'seg-1', workspaceId };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(segment),
        update: vi.fn().mockResolvedValue(segment),
      });
      const nats = makeNats();
      const svc = new SegmentService(repo as never, nats as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      const result = await svc.refreshSegment(workspaceId, 'seg-1', actor);
      expect(result).toEqual({ queued: true });
      expect(nats.publish).toHaveBeenCalledWith('segment.refresh', { workspaceId, segmentId: 'seg-1' });
    });

    it('throws SEGMENT_NOT_FOUND when segment missing', async () => {
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
      const svc = new SegmentService(repo as never, makeNats() as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.refreshSegment(workspaceId, 'missing', actor)).rejects.toThrow(NotFoundError);
    });
  });

  describe('previewSegment', () => {
    it('returns contacts and total from contactCount', async () => {
      const segment = { id: 'seg-1', workspaceId, contactCount: 42 };
      const previewRows = [{ contact: { id: 'c-1', email: 'a@b.com' } }];
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(segment),
        getPreviewContacts: vi.fn().mockResolvedValue(previewRows),
      });
      const svc = new SegmentService(repo as never, makeNats() as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      const result = await svc.previewSegment(workspaceId, 'seg-1', 10);
      expect(result.total).toBe(42);
      expect(result.contacts).toHaveLength(1);
    });
  });
});
