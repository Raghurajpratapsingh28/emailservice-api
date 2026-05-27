import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  listSendsQuerySchema,
  sendEmailBodySchema,
  sendIdParamSchema,
} from '../schemas/send.schema.js';
import {
  createTemplateBodySchema,
  listTemplatesQuerySchema,
  templateIdParamSchema,
  updateTemplateBodySchema,
} from '../schemas/template.schema.js';

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

export const transactionalController = {
  // ─── Email sends ─────────────────────────────────────────────────────────

  // POST /api/v1/emails/send
  async send(req: FastifyRequest, reply: FastifyReply) {
    const body = sendEmailBodySchema.parse(req.body);
    const result = await req.server.services.transactional.sendEmail(
      workspaceId(req),
      body,
      actorCtx(req),
    );
    return reply.status(202).send(result);
  },

  // GET /api/v1/emails/:sendId
  async getSend(req: FastifyRequest, reply: FastifyReply) {
    const params = sendIdParamSchema.parse(req.params);
    const row = await req.server.services.transactional.getSend(workspaceId(req), params.sendId);
    return reply.status(200).send({
      sendId: row.sendId,
      status: row.status,
      providerMessageId: row.providerMessageId,
      failureReason: row.failureReason,
      subject: row.subject,
      senderEmail: row.senderEmail,
      recipientEmail: row.recipientEmail,
      tags: row.tags,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  // GET /api/v1/emails
  async listSends(req: FastifyRequest, reply: FastifyReply) {
    const query = listSendsQuerySchema.parse(req.query);
    const result = await req.server.services.transactional.listSends(workspaceId(req), query);
    return reply.status(200).send(result);
  },

  // ─── Email templates ─────────────────────────────────────────────────────

  // POST /api/v1/email-templates
  async createTemplate(req: FastifyRequest, reply: FastifyReply) {
    const body = createTemplateBodySchema.parse(req.body);
    const created = await req.server.services.transactional.createTemplate(
      workspaceId(req),
      body,
      actorCtx(req),
    );
    return reply.status(201).send({ template: created });
  },

  // GET /api/v1/email-templates
  async listTemplates(req: FastifyRequest, reply: FastifyReply) {
    const query = listTemplatesQuerySchema.parse(req.query);
    const result = await req.server.services.transactional.listTemplates(
      workspaceId(req),
      query,
    );
    return reply.status(200).send(result);
  },

  // GET /api/v1/email-templates/:id
  async getTemplate(req: FastifyRequest, reply: FastifyReply) {
    const params = templateIdParamSchema.parse(req.params);
    const template = await req.server.services.transactional.getTemplate(
      workspaceId(req),
      params.id,
    );
    return reply.status(200).send({ template });
  },

  // PATCH /api/v1/email-templates/:id
  async updateTemplate(req: FastifyRequest, reply: FastifyReply) {
    const params = templateIdParamSchema.parse(req.params);
    const body = updateTemplateBodySchema.parse(req.body);
    const template = await req.server.services.transactional.updateTemplate(
      workspaceId(req),
      params.id,
      body,
      actorCtx(req),
    );
    return reply.status(200).send({ template });
  },

  // DELETE /api/v1/email-templates/:id
  async deleteTemplate(req: FastifyRequest, reply: FastifyReply) {
    const params = templateIdParamSchema.parse(req.params);
    await req.server.services.transactional.deleteTemplate(
      workspaceId(req),
      params.id,
      actorCtx(req),
    );
    return reply.status(204).send();
  },
};
