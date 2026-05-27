import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  createWorkflowBodySchema,
  listExecutionsQuerySchema,
  listWorkflowsQuerySchema,
  updateWorkflowBodySchema,
  workflowIdParamSchema,
} from '../schemas/workflow.schema.js';

function actorCtx(req: FastifyRequest) {
  if (!req.authedUser) throw new UnauthorizedError();
  return {
    user: req.authedUser,
    ipAddress: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}

function workspaceId(req: FastifyRequest): string {
  if (!req.workspace) throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
  return req.workspace.id;
}

export const workflowController = {
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createWorkflowBodySchema.parse(req.body);
    const workflow = await req.server.services.workflows.createWorkflow(workspaceId(req), body, actorCtx(req));
    return reply.status(201).send({ workflow });
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workflowIdParamSchema.parse(req.params);
    const body = updateWorkflowBodySchema.parse(req.body);
    const workflow = await req.server.services.workflows.updateWorkflow(workspaceId(req), id, body, actorCtx(req));
    return reply.status(200).send({ workflow });
  },

  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = listWorkflowsQuerySchema.parse(req.query);
    const result = await req.server.services.workflows.listWorkflows(workspaceId(req), query);
    return reply.status(200).send(result);
  },

  async get(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workflowIdParamSchema.parse(req.params);
    const workflow = await req.server.services.workflows.getWorkflow(workspaceId(req), id);
    return reply.status(200).send({ workflow });
  },

  async publish(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workflowIdParamSchema.parse(req.params);
    const workflow = await req.server.services.workflows.publishWorkflow(workspaceId(req), id, actorCtx(req));
    return reply.status(200).send({ workflow });
  },

  async pause(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workflowIdParamSchema.parse(req.params);
    const workflow = await req.server.services.workflows.pauseWorkflow(workspaceId(req), id, actorCtx(req));
    return reply.status(200).send({ workflow });
  },

  async resume(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workflowIdParamSchema.parse(req.params);
    const workflow = await req.server.services.workflows.resumeWorkflow(workspaceId(req), id, actorCtx(req));
    return reply.status(200).send({ workflow });
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workflowIdParamSchema.parse(req.params);
    await req.server.services.workflows.deleteWorkflow(workspaceId(req), id, actorCtx(req));
    return reply.status(204).send();
  },

  async listExecutions(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workflowIdParamSchema.parse(req.params);
    const { page, pageSize } = listExecutionsQuerySchema.parse(req.query);
    const result = await req.server.services.workflows.listExecutions(workspaceId(req), id, page, pageSize);
    return reply.status(200).send(result);
  },
};
