import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { campaignController } from './controllers/campaign.controller.js';

/**
 * Campaign routes — mounted at `/api/v1/campaigns`.
 *
 * Permission map:
 *   - read endpoints (GET): campaigns.read
 *   - write endpoints (POST/PATCH/DELETE except /send): campaigns.write
 *   - send + pause + resume: campaigns.send (the most privileged op)
 */
export default async function campaignRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_WRITE),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Create a draft campaign',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.create,
  );

  app.get(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_READ),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'List campaigns',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.list,
  );

  app.get(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_READ),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Get campaign details',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.get,
  );

  app.patch(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_WRITE),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Update a draft campaign',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.update,
  );

  app.post(
    '/:id/schedule',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_SEND),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Schedule a campaign for future delivery',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.schedule,
  );

  app.post(
    '/:id/send',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_SEND),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Trigger immediate campaign send',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.send,
  );

  app.post(
    '/:id/pause',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_SEND),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Pause a scheduled or sending campaign',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.pause,
  );

  app.post(
    '/:id/resume',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_SEND),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Resume a paused campaign',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.resume,
  );

  app.delete(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.CAMPAIGNS_WRITE),
      ],
      schema: {
        tags: ['campaigns'],
        summary: 'Soft-delete a campaign',
        security: [{ bearerAuth: [] }],
      },
    },
    campaignController.remove,
  );
}
