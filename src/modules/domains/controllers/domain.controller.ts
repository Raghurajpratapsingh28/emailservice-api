import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  createDomainBodySchema,
  domainIdParamSchema,
  listDomainsQuerySchema,
} from '../schemas/domain.schema.js';

function actorCtx(req: FastifyRequest) {
  if (!req.authedUser) {
    throw new UnauthorizedError();
  }
  return {
    user: req.authedUser,
    ipAddress: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    requestId: req.id,
  };
}

function workspaceId(req: FastifyRequest): string {
  if (!req.workspace) {
    throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
  }
  return req.workspace.id;
}

export const domainController = {
  // POST /
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createDomainBodySchema.parse(req.body);
    const result = await req.server.services.domains.createDomain(
      workspaceId(req),
      body.domain,
      actorCtx(req),
    );
    return reply.status(201).send(result);
  },

  // GET /
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = listDomainsQuerySchema.parse(req.query);
    const result = await req.server.services.domains.listDomains(workspaceId(req), {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status as never,
    });
    return reply.status(200).send(result);
  },

  // GET /:id
  async get(req: FastifyRequest, reply: FastifyReply) {
    const params = domainIdParamSchema.parse(req.params);
    const result = await req.server.services.domains.getDomain(workspaceId(req), params.id);
    return reply.status(200).send(result);
  },

  // POST /:id/verify
  async verify(req: FastifyRequest, reply: FastifyReply) {
    const params = domainIdParamSchema.parse(req.params);
    const result = await req.server.services.domains.requeueVerification(
      workspaceId(req),
      params.id,
      actorCtx(req),
    );
    return reply.status(202).send(result);
  },

  // DELETE /:id
  async remove(req: FastifyRequest, reply: FastifyReply) {
    const params = domainIdParamSchema.parse(req.params);
    await req.server.services.domains.deleteDomain(workspaceId(req), params.id, actorCtx(req));
    return reply.status(204).send();
  },
};
