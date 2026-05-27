import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, isNull, and } from 'drizzle-orm';
import { UnauthorizedError, ValidationError } from '@shared/errors/app-errors.js';
import { PLAN_LIMITS, type PlanTier } from '@constants/plan-limits.js';
import { workspaces } from '@shared/database/schema/workspaces.js';

/**
 * Loads the active workspace plan onto `request.workspacePlan`. Used by feature
 * gates (e.g. quotas) downstream of `workspace-guard`.
 *
 * Requires `request.workspace` to be set (workspace-guard runs first).
 */

declare module 'fastify' {
  interface FastifyRequest {
    workspacePlan?: { tier: PlanTier; limits: typeof PLAN_LIMITS[PlanTier] };
  }
}

export async function loadWorkspacePlan(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!req.workspace) {
    throw new UnauthorizedError('Workspace context required', 'WORKSPACE_REQUIRED');
  }
  const rows = await req.server.db
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(and(eq(workspaces.id, req.workspace.id), isNull(workspaces.deletedAt)))
    .limit(1);

  const plan = rows[0]?.plan as PlanTier | undefined;
  if (!plan || !(plan in PLAN_LIMITS)) {
    throw new ValidationError('Workspace plan is invalid', { plan });
  }
  req.workspacePlan = { tier: plan, limits: PLAN_LIMITS[plan] };
}
