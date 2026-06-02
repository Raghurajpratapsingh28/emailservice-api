import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  addContactToSegmentBodySchema,
  createSegmentBodySchema,
  listSegmentsQuerySchema,
  previewSegmentQuerySchema,
  segmentContactParamSchema,
  segmentIdParamSchema,
  updateSegmentBodySchema,
} from '../schemas/segment.schema.js';

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

export const segmentController = {
  // POST /api/v1/segments
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createSegmentBodySchema.parse(req.body);
    const segment = await req.server.services.segments.createSegment(workspaceId(req), body, actorCtx(req));
    return reply.status(201).send({ segment });
  },

  // GET /api/v1/segments
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = listSegmentsQuerySchema.parse(req.query);
    const result = await req.server.services.segments.listSegments(workspaceId(req), query);
    return reply.status(200).send(result);
  },

  // GET /api/v1/segments/:id
  async get(req: FastifyRequest, reply: FastifyReply) {
    const { id } = segmentIdParamSchema.parse(req.params);
    const segment = await req.server.services.segments.getSegment(workspaceId(req), id);
    return reply.status(200).send({ segment });
  },

  // PATCH /api/v1/segments/:id
  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = segmentIdParamSchema.parse(req.params);
    const body = updateSegmentBodySchema.parse(req.body);
    const segment = await req.server.services.segments.updateSegment(workspaceId(req), id, body, actorCtx(req));
    return reply.status(200).send({ segment });
  },

  // DELETE /api/v1/segments/:id
  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = segmentIdParamSchema.parse(req.params);
    await req.server.services.segments.deleteSegment(workspaceId(req), id, actorCtx(req));
    return reply.status(204).send();
  },

  // POST /api/v1/segments/:id/refresh
  async refresh(req: FastifyRequest, reply: FastifyReply) {
    const { id } = segmentIdParamSchema.parse(req.params);
    const result = await req.server.services.segments.refreshSegment(workspaceId(req), id, actorCtx(req));
    return reply.status(202).send(result);
  },

  // GET /api/v1/segments/:id/preview
  async preview(req: FastifyRequest, reply: FastifyReply) {
    const { id } = segmentIdParamSchema.parse(req.params);
    const { limit } = previewSegmentQuerySchema.parse(req.query);
    const result = await req.server.services.segments.previewSegment(workspaceId(req), id, limit);
    return reply.status(200).send(result);
  },

  // POST /api/v1/segments/:id/contacts
  async addContact(req: FastifyRequest, reply: FastifyReply) {
    const { id } = segmentIdParamSchema.parse(req.params);
    const { contactId } = addContactToSegmentBodySchema.parse(req.body);
    await req.server.services.segments.addContactToSegment(workspaceId(req), id, contactId, actorCtx(req));
    return reply.status(204).send();
  },

  // DELETE /api/v1/segments/:id/contacts/:contactId
  async removeContact(req: FastifyRequest, reply: FastifyReply) {
    const { id, contactId } = segmentContactParamSchema.parse(req.params);
    await req.server.services.segments.removeContactFromSegment(workspaceId(req), id, contactId, actorCtx(req));
    return reply.status(204).send();
  },
};
