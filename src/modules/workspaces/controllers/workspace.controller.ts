import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  createWorkspaceBodySchema,
  listMembersQuerySchema,
  switchWorkspaceBodySchema,
  transferOwnershipBodySchema,
  updateMemberRoleBodySchema,
  updateSettingsBodySchema,
  updateWorkspaceBodySchema,
  workspaceIdParamSchema,
  workspaceMemberParamsSchema,
} from '../schemas/workspace.schema.js';

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

/**
 * Workspace controller — every handler is a thin shim:
 *   1. Parse path/query/body via Zod
 *   2. Build actor context
 *   3. Delegate to service
 *   4. Shape HTTP response
 *
 * Workspace-id is read from path params for the per-workspace routes; the
 * `app.workspaceGuard` middleware that runs before these handlers has already
 * validated membership using the same id.
 */
export const workspaceController = {
  // 1. POST /
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createWorkspaceBodySchema.parse(req.body);
    const result = await req.server.services.workspaces.createWorkspace(body, actorCtx(req));
    return reply.status(201).send({ workspace: result.workspace, role: result.role });
  },

  // 2. GET /
  async list(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const items = await req.server.services.workspaces.listUserWorkspaces(req.authedUser.id);
    return reply.status(200).send({ items });
  },

  // 3. GET /current
  async current(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser || !req.workspace) {
      throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
    }
    const result = await req.server.services.workspaces.getCurrentWorkspace(
      req.workspace.id,
      req.authedUser.id,
    );
    return reply.status(200).send(result);
  },

  // 4. PATCH /:workspaceId
  async update(req: FastifyRequest, reply: FastifyReply) {
    const params = workspaceIdParamSchema.parse(req.params);
    const body = updateWorkspaceBodySchema.parse(req.body);
    const ws = await req.server.services.workspaces.updateWorkspace(
      params.workspaceId,
      body,
      actorCtx(req),
    );
    return reply.status(200).send({ workspace: ws });
  },

  // 5. POST /switch
  async switch(req: FastifyRequest, reply: FastifyReply) {
    const body = switchWorkspaceBodySchema.parse(req.body);
    const result = await req.server.services.workspaces.switchWorkspace(
      body.workspaceId,
      actorCtx(req),
    );
    return reply.status(200).send(result);
  },

  // 6a. GET /:workspaceId/settings
  async getSettings(req: FastifyRequest, reply: FastifyReply) {
    const params = workspaceIdParamSchema.parse(req.params);
    const settings = await req.server.services.workspaces.getSettings(params.workspaceId);
    return reply.status(200).send({ settings });
  },

  // 6b. PATCH /:workspaceId/settings
  async updateSettings(req: FastifyRequest, reply: FastifyReply) {
    const params = workspaceIdParamSchema.parse(req.params);
    const body = updateSettingsBodySchema.parse(req.body);
    const settings = await req.server.services.workspaces.updateSettings(
      params.workspaceId,
      body,
      actorCtx(req),
    );
    return reply.status(200).send({ settings });
  },

  // 7. GET /:workspaceId/members
  async listMembers(req: FastifyRequest, reply: FastifyReply) {
    const params = workspaceIdParamSchema.parse(req.params);
    const query = listMembersQuerySchema.parse(req.query);
    const result = await req.server.services.workspaces.listMembers(params.workspaceId, query);
    return reply.status(200).send(result);
  },

  // 8. PATCH /:workspaceId/members/:memberId
  async updateMemberRole(req: FastifyRequest, reply: FastifyReply) {
    if (!req.workspace) {
      throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
    }
    const params = workspaceMemberParamsSchema.parse(req.params);
    const body = updateMemberRoleBodySchema.parse(req.body);
    const result = await req.server.services.workspaces.updateMemberRole(
      params.workspaceId,
      params.memberId,
      body,
      actorCtx(req),
      req.workspace.role,
    );
    return reply.status(200).send(result);
  },

  // 9. DELETE /:workspaceId/members/:memberId
  async removeMember(req: FastifyRequest, reply: FastifyReply) {
    if (!req.workspace) {
      throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
    }
    const params = workspaceMemberParamsSchema.parse(req.params);
    await req.server.services.workspaces.removeMember(
      params.workspaceId,
      params.memberId,
      actorCtx(req),
      req.workspace.role,
    );
    return reply.status(204).send();
  },

  // 10. POST /:workspaceId/transfer-ownership
  async transferOwnership(req: FastifyRequest, reply: FastifyReply) {
    const params = workspaceIdParamSchema.parse(req.params);
    const body = transferOwnershipBodySchema.parse(req.body);
    const result = await req.server.services.workspaces.transferOwnership(
      params.workspaceId,
      body.newOwnerUserId,
      actorCtx(req),
    );
    return reply.status(200).send(result);
  },

  // 11. POST /:workspaceId/deactivate
  async deactivate(req: FastifyRequest, reply: FastifyReply) {
    const params = workspaceIdParamSchema.parse(req.params);
    const ws = await req.server.services.workspaces.deactivate(params.workspaceId, actorCtx(req));
    return reply.status(200).send({ workspace: ws });
  },

  // 12. POST /:workspaceId/reactivate
  async reactivate(req: FastifyRequest, reply: FastifyReply) {
    const params = workspaceIdParamSchema.parse(req.params);
    const ws = await req.server.services.workspaces.reactivate(params.workspaceId, actorCtx(req));
    return reply.status(200).send({ workspace: ws });
  },
};
