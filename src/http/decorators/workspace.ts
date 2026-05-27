import fp from 'fastify-plugin';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { authenticate } from '@http/middleware/authenticate.js';
import { internalAuth } from '@http/middleware/internal-auth.js';
import { loadWorkspacePlan } from '@http/middleware/workspace-plan.js';
import { workspaceGuard } from '@modules/auth/middleware/workspace-guard.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Auth preHandler — verifies JWT and hydrates request.user. */
    authenticate: preHandlerHookHandler;
    /** Verifies internal service-to-service API key. */
    internalAuth: preHandlerHookHandler;
    /** Resolves and validates workspace context (must run after `authenticate`). */
    workspaceGuard: preHandlerHookHandler;
    /** Loads the workspace plan info onto request (must run after `workspaceGuard`). */
    workspacePlan: preHandlerHookHandler;
  }
}

/**
 * Registers convenience preHandler decorators so routes can write:
 *   { preHandler: [app.authenticate, app.workspaceGuard, requirePermissions(...)] }
 */
export default fp(
  async function decorators(app: FastifyInstance) {
    app.decorate('authenticate', authenticate);
    app.decorate('internalAuth', internalAuth);
    app.decorate('workspaceGuard', workspaceGuard);
    app.decorate('workspacePlan', loadWorkspacePlan);
  },
  { name: 'http-decorators' },
);
