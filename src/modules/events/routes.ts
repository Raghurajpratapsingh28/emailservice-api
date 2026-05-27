import type { FastifyInstance } from 'fastify';
import { eventController } from './controllers/event.controller.js';

/**
 * Event ingestion routes.
 *
 * These endpoints use WRITE KEY auth (not JWT). The key is resolved inside
 * each controller handler via `resolveWriteKey`.
 *
 * CORS is intentionally permissive here so browser SDKs can call these
 * endpoints from any origin. The write key is the auth mechanism.
 *
 * Routes are mounted at `/api/v1` (track, identify, page, group, alias)
 * and `/api/v1/events` (debug, schemas).
 */
export default async function eventRoutes(app: FastifyInstance): Promise<void> {
  // ─── Ingestion endpoints ─────────────────────────────────────────────────

  app.post(
    '/track',
    {
      schema: {
        tags: ['events'],
        summary: 'Track a custom event',
        description: 'Authenticated via x-write-key or Authorization: Bearer <write-key>',
      },
    },
    eventController.track,
  );

  app.post(
    '/identify',
    {
      schema: {
        tags: ['events'],
        summary: 'Identify a user with traits',
      },
    },
    eventController.identify,
  );

  app.post(
    '/page',
    {
      schema: {
        tags: ['events'],
        summary: 'Record a page view (normalised to "Page Viewed")',
      },
    },
    eventController.page,
  );

  app.post(
    '/group',
    {
      schema: {
        tags: ['events'],
        summary: 'Associate a user with a group',
      },
    },
    eventController.group,
  );

  app.post(
    '/alias',
    {
      schema: {
        tags: ['events'],
        summary: 'Merge two identities',
      },
    },
    eventController.alias,
  );

  // ─── Debug endpoints ─────────────────────────────────────────────────────

  app.get(
    '/events/debug',
    {
      schema: {
        tags: ['events'],
        summary: 'List recent raw events for the write-key workspace',
      },
    },
    eventController.debug,
  );

  app.get(
    '/events/schemas',
    {
      schema: {
        tags: ['events'],
        summary: 'List active event schemas for the write-key workspace',
      },
    },
    eventController.schemas,
  );
}
