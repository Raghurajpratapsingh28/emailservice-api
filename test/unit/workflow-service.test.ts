import { describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '@shared/errors/app-errors.js';
import { WorkflowService } from '@modules/workflows/services/workflow.service.js';
import type { WorkflowGraph } from '@shared/database/schema/workflows.js';

const validGraph: WorkflowGraph = {
  nodes: [
    { id: 'trigger_1', type: 'trigger', config: { triggerType: 'event', eventName: 'Trial Started' } },
    { id: 'email_1', type: 'email', config: { subject: 'Welcome!', fromEmail: 'hi@acme.com', html: '<h1>Hi</h1>' } },
    { id: 'end_1', type: 'end' },
  ],
  edges: [{ from: 'trigger_1', to: 'email_1' }, { from: 'email_1', to: 'end_1' }],
};

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    insert: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    transitionStatus: vi.fn(),
    softDelete: vi.fn(),
    listExecutions: vi.fn(),
    getExecutionStats: vi.fn().mockResolvedValue({ total: 0, completed: 0, failed: 0, running: 0 }),
    ...overrides,
  };
}

function makeNats() {
  return { publish: vi.fn(), request: vi.fn(), close: vi.fn(), connection: {} };
}

function makeRedis() {
  return { set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeLog() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

const actor = { user: { id: 'user-1' }, ipAddress: '127.0.0.1' };
const workspaceId = 'ws-1';

describe('WorkflowService', () => {
  describe('createWorkflow', () => {
    it('creates a workflow with valid graph', async () => {
      const workflow = { id: 'wf-1', workspaceId, name: 'Test', status: 'draft' };
      const repo = makeRepo({ insert: vi.fn().mockResolvedValue(workflow) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.createWorkflow(workspaceId, { name: 'Test', graph: validGraph }, actor);
      expect(result.id).toBe('wf-1');
      expect(result.status).toBe('draft');
    });

    it('rejects invalid graph', async () => {
      const repo = makeRepo();
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const badGraph: WorkflowGraph = {
        nodes: [{ id: 'end_1', type: 'end' }],
        edges: [],
      };
      await expect(svc.createWorkflow(workspaceId, { name: 'Bad', graph: badGraph }, actor)).rejects.toThrow(ValidationError);
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('updateWorkflow', () => {
    it('rejects update on published workflow', async () => {
      const workflow = { id: 'wf-1', workspaceId, status: 'published' };
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(workflow) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.updateWorkflow(workspaceId, 'wf-1', { name: 'New' }, actor)).rejects.toThrow(ValidationError);
    });

    it('throws WORKFLOW_NOT_FOUND when missing', async () => {
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.updateWorkflow(workspaceId, 'missing', { name: 'X' }, actor)).rejects.toThrow(NotFoundError);
    });
  });

  describe('publishWorkflow', () => {
    it('publishes a draft workflow and enqueues NATS message', async () => {
      const workflow = { id: 'wf-1', workspaceId, status: 'draft', graph: validGraph };
      const published = { ...workflow, status: 'published', publishedAt: new Date() };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(workflow),
        transitionStatus: vi.fn().mockResolvedValue(published),
      });
      const nats = makeNats();
      const svc = new WorkflowService(repo as never, nats as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.publishWorkflow(workspaceId, 'wf-1', actor);
      expect(result.status).toBe('published');
      expect(nats.publish).toHaveBeenCalledWith('workflow.register', { workspaceId, workflowId: 'wf-1' });
    });

    it('throws WORKFLOW_ALREADY_PUBLISHED when already published', async () => {
      const workflow = { id: 'wf-1', workspaceId, status: 'published', graph: validGraph };
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(workflow) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.publishWorkflow(workspaceId, 'wf-1', actor)).rejects.toThrow(ConflictError);
    });

    it('rejects publish when Redis lock already held', async () => {
      const workflow = { id: 'wf-1', workspaceId, status: 'draft', graph: validGraph };
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(workflow) });
      const redis = makeRedis();
      redis.set = vi.fn().mockResolvedValue(null); // lock not acquired
      const svc = new WorkflowService(repo as never, makeNats() as never, redis as never, makeAudit() as never, makeLog() as never);

      await expect(svc.publishWorkflow(workspaceId, 'wf-1', actor)).rejects.toThrow(ConflictError);
    });

    it('validates graph before publishing', async () => {
      const badGraph = { nodes: [{ id: 'end_1', type: 'end' }], edges: [] };
      const workflow = { id: 'wf-1', workspaceId, status: 'draft', graph: badGraph };
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(workflow) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.publishWorkflow(workspaceId, 'wf-1', actor)).rejects.toThrow(ValidationError);
    });
  });

  describe('pauseWorkflow', () => {
    it('pauses a published workflow', async () => {
      const paused = { id: 'wf-1', workspaceId, status: 'paused' };
      const repo = makeRepo({ transitionStatus: vi.fn().mockResolvedValue(paused) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.pauseWorkflow(workspaceId, 'wf-1', actor);
      expect(result.status).toBe('paused');
    });

    it('throws INVALID_WORKFLOW_STATE when not published', async () => {
      const workflow = { id: 'wf-1', workspaceId, status: 'draft' };
      const repo = makeRepo({
        transitionStatus: vi.fn().mockResolvedValue(null),
        findById: vi.fn().mockResolvedValue(workflow),
      });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.pauseWorkflow(workspaceId, 'wf-1', actor)).rejects.toThrow(ValidationError);
    });
  });

  describe('resumeWorkflow', () => {
    it('resumes a paused workflow', async () => {
      const resumed = { id: 'wf-1', workspaceId, status: 'published' };
      const repo = makeRepo({ transitionStatus: vi.fn().mockResolvedValue(resumed) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.resumeWorkflow(workspaceId, 'wf-1', actor);
      expect(result.status).toBe('published');
    });
  });

  describe('deleteWorkflow', () => {
    it('soft-deletes successfully', async () => {
      const repo = makeRepo({ softDelete: vi.fn().mockResolvedValue({ id: 'wf-1' }) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.deleteWorkflow(workspaceId, 'wf-1', actor)).resolves.toBeUndefined();
    });

    it('throws WORKFLOW_NOT_FOUND when missing', async () => {
      const repo = makeRepo({ softDelete: vi.fn().mockResolvedValue(null) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.deleteWorkflow(workspaceId, 'missing', actor)).rejects.toThrow(NotFoundError);
    });
  });

  describe('listExecutions', () => {
    it('throws WORKFLOW_NOT_FOUND when workflow missing', async () => {
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      await expect(svc.listExecutions(workspaceId, 'missing', 1, 20)).rejects.toThrow(NotFoundError);
    });

    it('returns paginated executions', async () => {
      const workflow = { id: 'wf-1', workspaceId };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(workflow),
        listExecutions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      });
      const svc = new WorkflowService(repo as never, makeNats() as never, makeRedis() as never, makeAudit() as never, makeLog() as never);

      const result = await svc.listExecutions(workspaceId, 'wf-1', 1, 20);
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });
});
