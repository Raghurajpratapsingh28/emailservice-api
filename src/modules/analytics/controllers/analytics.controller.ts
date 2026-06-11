import type { FastifyRequest, FastifyReply } from 'fastify';

export const analyticsController = {
  async summary(req: FastifyRequest, reply: FastifyReply) {
    const workspaceId = req.workspace!.id;
    const data = await req.server.services.analytics.getWorkspaceSummary(workspaceId);
    return reply.status(200).send(data);
  },
};
