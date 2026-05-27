import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  acceptInviteBodySchema,
  forgotPasswordBodySchema,
  inviteBodySchema,
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  resetPasswordBodySchema,
  revokeSessionParamsSchema,
  signupBodySchema,
  verifyEmailBodySchema,
} from '../schemas/auth.schema.js';
import {
  UnauthorizedError,
  ValidationError,
} from '@shared/errors/app-errors.js';

function reqCtx(req: FastifyRequest): {
  ipAddress?: string;
  userAgent?: string;
  accessJti?: string;
} {
  return {
    ipAddress: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    accessJti: req.accessJti,
  };
}

export const authController = {
  async signup(req: FastifyRequest, reply: FastifyReply) {
    const body = signupBodySchema.parse(req.body);
    const result = await req.server.services.auth.signup(body, reqCtx(req));
    return reply.status(201).send(result);
  },

  async login(req: FastifyRequest, reply: FastifyReply) {
    const body = loginBodySchema.parse(req.body);
    const tokens = await req.server.services.auth.login(body, reqCtx(req));
    return reply.status(200).send(tokens);
  },

  async refresh(req: FastifyRequest, reply: FastifyReply) {
    const body = refreshBodySchema.parse(req.body);
    const tokens = await req.server.services.auth.refresh(body.refreshToken, reqCtx(req));
    return reply.status(200).send(tokens);
  },

  async logout(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const body = logoutBodySchema.parse(req.body ?? {});
    if (!body.refreshToken) {
      throw new ValidationError('refreshToken is required');
    }
    await req.server.services.auth.logout(body.refreshToken, reqCtx(req), req.authedUser.id);
    return reply.status(204).send();
  },

  async logoutAll(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const result = await req.server.services.auth.logoutAll(req.authedUser.id, reqCtx(req));
    return reply.status(200).send(result);
  },

  async forgotPassword(req: FastifyRequest, reply: FastifyReply) {
    const body = forgotPasswordBodySchema.parse(req.body);
    await req.server.services.auth.forgotPassword(body.email, reqCtx(req));
    return reply.status(202).send({ status: 'accepted' });
  },

  async resetPassword(req: FastifyRequest, reply: FastifyReply) {
    const body = resetPasswordBodySchema.parse(req.body);
    await req.server.services.auth.resetPassword(body.token, body.password, reqCtx(req));
    return reply.status(200).send({ status: 'ok' });
  },

  async verifyEmail(req: FastifyRequest, reply: FastifyReply) {
    const body = verifyEmailBodySchema.parse(req.body);
    await req.server.services.auth.verifyEmail(body.token, reqCtx(req));
    return reply.status(200).send({ status: 'ok' });
  },

  async resendVerification(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    await req.server.services.auth.resendVerification(req.authedUser.id);
    return reply.status(202).send({ status: 'accepted' });
  },

  async invite(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser || !req.workspace) {
      throw new UnauthorizedError();
    }
    const body = inviteBodySchema.parse(req.body);
    const result = await req.server.services.auth.inviteUser(
      {
        workspaceId: req.workspace.id,
        invitedByUserId: req.authedUser.id,
        inviterRole: req.workspace.role,
        email: body.email,
        role: body.role,
      },
      reqCtx(req),
    );
    return reply.status(201).send(result);
  },

  async acceptInvite(req: FastifyRequest, reply: FastifyReply) {
    const body = acceptInviteBodySchema.parse(req.body);
    const result = await req.server.services.auth.acceptInvite(
      body,
      reqCtx(req),
      req.authedUser?.id,
    );
    return reply.status(200).send(result);
  },

  async me(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const me = await req.server.services.auth.getCurrentUser(req.authedUser.id);
    return reply.status(200).send(me);
  },

  async updateProfile(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const body = req.body as { firstName?: string; lastName?: string };
    if (!body.firstName && !body.lastName) {
      throw new ValidationError('At least one field required');
    }
    const updated = await req.server.services.auth.updateProfile(req.authedUser.id, body);
    return reply.status(200).send(updated);
  },

  async changePassword(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const body = req.body as { currentPassword: string; newPassword: string };
    await req.server.services.auth.changePassword(
      req.authedUser.id,
      body.currentPassword,
      body.newPassword,
      reqCtx(req),
    );
    return reply.status(200).send({ status: 'ok' });
  },

  async listSessions(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const sessions = await req.server.services.auth.listSessions(
      req.authedUser.id,
      req.accessJti,
    );
    return reply.status(200).send({ items: sessions });
  },

  async revokeSession(req: FastifyRequest, reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError();
    }
    const params = revokeSessionParamsSchema.parse(req.params);
    await req.server.services.auth.revokeSession(req.authedUser.id, params.sessionId);
    return reply.status(204).send();
  },
};
