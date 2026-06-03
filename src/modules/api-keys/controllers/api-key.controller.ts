import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  apiKeyIdParamSchema,
  createApiKeyBodySchema,
  listApiKeysQuerySchema,
} from '../schemas/api-key.schema.js';

function actorCtx(req: FastifyRequest) {
  if (!req.authedUser) throw new UnauthorizedError();
  return {
    user: req.authedUser,
    ipAddress: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    requestId: req.id,
  };
}

function workspaceId(req: FastifyRequest): string {
  if (!req.workspace) throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
  return req.workspace.id;
}

export const apiKeyController = {
  // POST /api/v1/api-keys
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createApiKeyBodySchema.parse(req.body);
    const result = await req.server.services.apiKeys.createApiKey(workspaceId(req), body, actorCtx(req));
    // Return the plaintext key only once — never shown again
    return reply.status(201).send({
      apiKey: result.apiKey,
      key: result.plaintextKey,
    });
  },

  // GET /api/v1/api-keys
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = listApiKeysQuerySchema.parse(req.query);
    const result = await req.server.services.apiKeys.listApiKeys(workspaceId(req), query);
    return reply.status(200).send(result);
  },

  // GET /api/v1/api-keys/:id
  async get(req: FastifyRequest, reply: FastifyReply) {
    const { id } = apiKeyIdParamSchema.parse(req.params);
    const apiKey = await req.server.services.apiKeys.getApiKey(workspaceId(req), id);
    return reply.status(200).send({ apiKey });
  },

  // DELETE /api/v1/api-keys/:id
  async revoke(req: FastifyRequest, reply: FastifyReply) {
    const { id } = apiKeyIdParamSchema.parse(req.params);
    await req.server.services.apiKeys.revokeApiKey(workspaceId(req), id, actorCtx(req));
    return reply.status(204).send();
  },
};
