import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from '@shared/cache/client.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { Paginated } from '@shared/types/index.js';
import type { Workflow, WorkflowExecution, WorkflowGraph } from '@shared/database/schema/workflows.js';
import { ConflictError, NotFoundError, ValidationError } from '@shared/errors/app-errors.js';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import type { CreateWorkflowBody, ListWorkflowsQuery, UpdateWorkflowBody } from '../schemas/workflow.schema.js';
import { validateGraph } from '../validators/graph-validator.js';
import {
  workflowValidationFailures,
  workflowsCreated,
  workflowsPublished,
} from '@observability/workflow-metrics.js';

export interface ActorContext {
  user: { id: string };
  ipAddress?: string;
  userAgent?: string;
}

export interface WorkflowRegisterPayload {
  workspaceId: string;
  workflowId: string;
}

const PUBLISH_IDEMPOTENCY_TTL = 60; // seconds

export class WorkflowService {
  public constructor(
    private readonly repo: WorkflowRepository,
    private readonly nats: NatsClient,
    private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly log: FastifyBaseLogger,
  ) {}

  public async createWorkflow(
    workspaceId: string,
    body: CreateWorkflowBody,
    actor: ActorContext,
  ): Promise<Workflow> {
    // Validate graph upfront
    try {
      validateGraph(body.graph);
    } catch (err) {
      workflowValidationFailures.inc({ workspace_id: workspaceId });
      throw err;
    }

    const graph = body.graph as unknown as Record<string, unknown>;
    const triggerNode = body.graph.nodes.find((n) => n.type === 'trigger');
    const triggerType = (triggerNode?.config?.triggerType as string) ?? null;

    const workflow = await this.repo.insert({
      workspaceId,
      name: body.name,
      status: 'draft',
      triggerType,
      triggerConfig: (triggerNode?.config ?? {}) as Record<string, unknown>,
      graph,
      createdBy: actor.user.id,
    });

    workflowsCreated.inc({ workspace_id: workspaceId });
    this.log.info({ workflowId: workflow.id, workspaceId }, 'workflow created');

    await this.audit.record({
      action: 'workflow.created',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workflow',
      targetId: workflow.id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return workflow;
  }

  public async updateWorkflow(
    workspaceId: string,
    id: string,
    body: UpdateWorkflowBody,
    actor: ActorContext,
  ): Promise<Workflow> {
    const existing = await this.repo.findById(workspaceId, id);
    if (!existing) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');

    if (existing.status !== 'draft') {
      throw new ValidationError('Only draft workflows can be edited', { code: 'INVALID_WORKFLOW_STATE' });
    }

    const patch: Partial<Workflow> = {};
    if (body.name !== undefined) patch.name = body.name;

    if (body.graph !== undefined) {
      try {
        validateGraph(body.graph);
      } catch (err) {
        workflowValidationFailures.inc({ workspace_id: workspaceId });
        throw err;
      }
      patch.graph = body.graph as unknown as Record<string, unknown>;
      const triggerNode = body.graph.nodes.find((n) => n.type === 'trigger');
      patch.triggerType = (triggerNode?.config?.triggerType as string) ?? null;
      patch.triggerConfig = (triggerNode?.config ?? {}) as Record<string, unknown>;
    }

    const updated = await this.repo.update(workspaceId, id, patch);
    if (!updated) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');

    this.log.info({ workflowId: id, workspaceId }, 'workflow updated');
    await this.audit.record({
      action: 'workflow.updated',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workflow',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return updated;
  }

  public async getWorkflow(workspaceId: string, id: string): Promise<Workflow & { executionStats: object }> {
    const workflow = await this.repo.findById(workspaceId, id);
    if (!workflow) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');
    const executionStats = await this.repo.getExecutionStats(workspaceId, id);
    return { ...workflow, executionStats };
  }

  public async listWorkflows(
    workspaceId: string,
    query: ListWorkflowsQuery,
  ): Promise<Paginated<Workflow>> {
    const { items, total } = await this.repo.list({ workspaceId, page: query.page, pageSize: query.pageSize });
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  public async publishWorkflow(
    workspaceId: string,
    id: string,
    actor: ActorContext,
  ): Promise<Workflow> {
    const existing = await this.repo.findById(workspaceId, id);
    if (!existing) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');

    if (existing.status === 'published') {
      throw new ConflictError('Workflow is already published', 'WORKFLOW_ALREADY_PUBLISHED');
    }
    if (!['draft', 'paused'].includes(existing.status)) {
      throw new ValidationError('Workflow cannot be published from current state', { code: 'INVALID_WORKFLOW_STATE' });
    }

    // Validate graph before publish
    try {
      validateGraph(existing.graph as unknown as WorkflowGraph);
    } catch (err) {
      workflowValidationFailures.inc({ workspace_id: workspaceId });
      throw err;
    }

    // Idempotency guard — prevent double-publish race
    const idempotencyKey = `workflow:publish:${id}`;
    const locked = await this.redis.set(idempotencyKey, '1', 'EX', PUBLISH_IDEMPOTENCY_TTL, 'NX');
    if (!locked) {
      throw new ConflictError('Publish already in progress', 'WORKFLOW_ALREADY_PUBLISHED');
    }

    const updated = await this.repo.transitionStatus(workspaceId, id, ['draft', 'paused'], 'published', {
      publishedAt: new Date(),
    });
    if (!updated) {
      await this.redis.del(idempotencyKey);
      throw new ValidationError('Workflow state changed concurrently', { code: 'INVALID_WORKFLOW_STATE' });
    }

    // Publish locked NATS contract
    const payload: WorkflowRegisterPayload = { workspaceId, workflowId: id };
    try {
      this.nats.publish<WorkflowRegisterPayload>(NATS_SUBJECTS.WORKFLOW_REGISTER, payload);
    } catch (err) {
      this.log.error({ err, workflowId: id }, 'failed to publish workflow.register');
    }

    workflowsPublished.inc({ workspace_id: workspaceId });
    this.log.info({ workflowId: id, workspaceId }, 'workflow published');

    await this.audit.record({
      action: 'workflow.published',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workflow',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return updated;
  }

  public async pauseWorkflow(
    workspaceId: string,
    id: string,
    actor: ActorContext,
  ): Promise<Workflow> {
    const updated = await this.repo.transitionStatus(workspaceId, id, ['published'], 'paused', {
      pausedAt: new Date(),
    });
    if (!updated) {
      const existing = await this.repo.findById(workspaceId, id);
      if (!existing) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');
      throw new ValidationError('Only published workflows can be paused', { code: 'INVALID_WORKFLOW_STATE' });
    }

    this.log.info({ workflowId: id, workspaceId }, 'workflow paused');
    await this.audit.record({
      action: 'workflow.paused',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workflow',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return updated;
  }

  public async resumeWorkflow(
    workspaceId: string,
    id: string,
    actor: ActorContext,
  ): Promise<Workflow> {
    const updated = await this.repo.transitionStatus(workspaceId, id, ['paused'], 'published', {
      pausedAt: null,
    });
    if (!updated) {
      const existing = await this.repo.findById(workspaceId, id);
      if (!existing) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');
      throw new ValidationError('Only paused workflows can be resumed', { code: 'INVALID_WORKFLOW_STATE' });
    }

    this.log.info({ workflowId: id, workspaceId }, 'workflow resumed');
    await this.audit.record({
      action: 'workflow.resumed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workflow',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    return updated;
  }

  public async deleteWorkflow(
    workspaceId: string,
    id: string,
    actor: ActorContext,
  ): Promise<void> {
    const deleted = await this.repo.softDelete(workspaceId, id);
    if (!deleted) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');

    this.log.info({ workflowId: id, workspaceId }, 'workflow deleted');
    await this.audit.record({
      action: 'workflow.deleted',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workflow',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);
  }

  public async listExecutions(
    workspaceId: string,
    workflowId: string,
    page: number,
    pageSize: number,
  ): Promise<Paginated<WorkflowExecution>> {
    const existing = await this.repo.findById(workspaceId, workflowId);
    if (!existing) throw new NotFoundError('Workflow not found', 'WORKFLOW_NOT_FOUND');

    const { items, total } = await this.repo.listExecutions(workspaceId, workflowId, page, pageSize);
    return { items, page, pageSize, total };
  }
}
