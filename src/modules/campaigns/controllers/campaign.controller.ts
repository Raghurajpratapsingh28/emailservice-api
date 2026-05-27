import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  campaignIdParamSchema,
  createCampaignBodySchema,
  listCampaignsQuerySchema,
  scheduleCampaignBodySchema,
  updateCampaignBodySchema,
} from '../schemas/campaign.schema.js';

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

export const campaignController = {
  // POST /api/v1/campaigns
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createCampaignBodySchema.parse(req.body);
    const created = await req.server.services.campaigns.createCampaign(
      workspaceId(req),
      body,
      actorCtx(req),
    );
    return reply.status(201).send({ campaign: created });
  },

  // PATCH /api/v1/campaigns/:id
  async update(req: FastifyRequest, reply: FastifyReply) {
    const params = campaignIdParamSchema.parse(req.params);
    const body = updateCampaignBodySchema.parse(req.body);
    const updated = await req.server.services.campaigns.updateCampaign(
      workspaceId(req),
      params.id,
      body,
      actorCtx(req),
    );
    return reply.status(200).send({ campaign: updated });
  },

  // GET /api/v1/campaigns
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = listCampaignsQuerySchema.parse(req.query);
    const result = await req.server.services.campaigns.listCampaigns(workspaceId(req), query);
    return reply.status(200).send(result);
  },

  // GET /api/v1/campaigns/:id
  async get(req: FastifyRequest, reply: FastifyReply) {
    const params = campaignIdParamSchema.parse(req.params);
    const campaign = await req.server.services.campaigns.getCampaign(workspaceId(req), params.id);
    return reply.status(200).send({ campaign });
  },

  // POST /api/v1/campaigns/:id/schedule
  async schedule(req: FastifyRequest, reply: FastifyReply) {
    const params = campaignIdParamSchema.parse(req.params);
    const body = scheduleCampaignBodySchema.parse(req.body);
    const updated = await req.server.services.campaigns.scheduleCampaign(
      workspaceId(req),
      params.id,
      body.scheduledAt,
      actorCtx(req),
    );
    return reply.status(200).send({ campaign: updated });
  },

  // POST /api/v1/campaigns/:id/send
  async send(req: FastifyRequest, reply: FastifyReply) {
    const params = campaignIdParamSchema.parse(req.params);
    const result = await req.server.services.campaigns.sendCampaign(
      workspaceId(req),
      params.id,
      actorCtx(req),
    );
    return reply.status(202).send(result);
  },

  // POST /api/v1/campaigns/:id/pause
  async pause(req: FastifyRequest, reply: FastifyReply) {
    const params = campaignIdParamSchema.parse(req.params);
    const updated = await req.server.services.campaigns.pauseCampaign(
      workspaceId(req),
      params.id,
      actorCtx(req),
    );
    return reply.status(200).send({ campaign: updated });
  },

  // POST /api/v1/campaigns/:id/resume
  async resume(req: FastifyRequest, reply: FastifyReply) {
    const params = campaignIdParamSchema.parse(req.params);
    const updated = await req.server.services.campaigns.resumeCampaign(
      workspaceId(req),
      params.id,
      actorCtx(req),
    );
    return reply.status(200).send({ campaign: updated });
  },

  // DELETE /api/v1/campaigns/:id
  async remove(req: FastifyRequest, reply: FastifyReply) {
    const params = campaignIdParamSchema.parse(req.params);
    await req.server.services.campaigns.deleteCampaign(
      workspaceId(req),
      params.id,
      actorCtx(req),
    );
    return reply.status(204).send();
  },
};
