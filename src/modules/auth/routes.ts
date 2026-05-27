import type { FastifyInstance } from 'fastify';
import { config } from '@config/index.js';
import { authController } from './controllers/auth.controller.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { AuthRateLimitRules } from '@http/middleware/rate-limit.js';
import { PERMISSIONS } from '@constants/rbac.js';
import { parseDurationToSeconds } from '@shared/utils/time.js';

/**
 * Auth routes. Rate limiting is multi-axis (per-IP + per-email) backed by Redis,
 * so it works correctly across replicas and resists email-fixed brute-force.
 */
export default async function authRoutes(app: FastifyInstance): Promise<void> {
  const window = parseDurationToSeconds(config.RATE_LIMIT_AUTH_WINDOW);
  const max = config.RATE_LIMIT_AUTH_MAX;

  const loginLimit = AuthRateLimitRules.login(app.redis, {
    perIpMax: max * 2, // a single IP for an office is shared
    perEmailMax: max,
    windowSeconds: window,
  });
  const forgotLimit = AuthRateLimitRules.forgotPassword(app.redis, {
    perIpMax: max,
    perEmailMax: 5,
    windowSeconds: window,
  });
  const signupLimit = AuthRateLimitRules.signup(app.redis, {
    perIpMax: max,
    windowSeconds: window,
  });
  const refreshLimit = AuthRateLimitRules.refresh(app.redis, {
    perIpMax: max * 4, // refresh is the hot path; allow more
    windowSeconds: window,
  });

  // ─── Public ─────────────────────────────────────────────────────────────
  app.post(
    '/signup',
    {
      preHandler: signupLimit,
      schema: { tags: ['auth'], summary: 'Create account & workspace' },
    },
    authController.signup,
  );

  app.post(
    '/login',
    {
      preHandler: loginLimit,
      schema: { tags: ['auth'], summary: 'Login with email + password' },
    },
    authController.login,
  );

  app.post(
    '/refresh',
    {
      preHandler: refreshLimit,
      schema: { tags: ['auth'], summary: 'Rotate refresh token' },
    },
    authController.refresh,
  );

  app.post(
    '/forgot-password',
    {
      preHandler: forgotLimit,
      schema: { tags: ['auth'], summary: 'Request a password-reset email' },
    },
    authController.forgotPassword,
  );

  app.post(
    '/reset-password',
    {
      preHandler: forgotLimit,
      schema: { tags: ['auth'], summary: 'Reset password with token' },
    },
    authController.resetPassword,
  );

  app.post(
    '/verify-email',
    {
      preHandler: forgotLimit,
      schema: { tags: ['auth'], summary: 'Confirm email via token' },
    },
    authController.verifyEmail,
  );

  app.post(
    '/accept-invite',
    {
      preHandler: forgotLimit,
      schema: { tags: ['auth'], summary: 'Accept a workspace invitation' },
    },
    authController.acceptInvite,
  );

  // ─── Authenticated ──────────────────────────────────────────────────────
  app.post(
    '/logout',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token (current session)',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.logout,
  );

  app.post(
    '/logout-all',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Revoke all refresh tokens for the user',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.logoutAll,
  );

  app.post(
    '/resend-verification',
    {
      preHandler: [app.authenticate, ...forgotLimit],
      schema: {
        tags: ['auth'],
        summary: 'Resend verification email',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.resendVerification,
  );

  app.post(
    '/change-password',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Change password',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.changePassword,
  );

  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Current user + workspaces',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.me,
  );

  app.put(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Update user profile',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.updateProfile,
  );

  app.get(
    '/sessions',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'List active sessions',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.listSessions,
  );

  app.delete(
    '/sessions/:sessionId',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Revoke a specific session',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.revokeSession,
  );

  // ─── Workspace-scoped (invite) ──────────────────────────────────────────
  app.post(
    '/invites',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_MEMBERS_WRITE),
      ],
      schema: {
        tags: ['auth'],
        summary: 'Invite a user to the active workspace',
        security: [{ bearerAuth: [] }],
      },
    },
    authController.invite,
  );
}
