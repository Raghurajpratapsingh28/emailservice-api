import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/app-errors.js';
import {
  bulkImportBodySchema,
  contactIdParamSchema,
  createContactBodySchema,
  listContactsQuerySchema,
  updateContactBodySchema,
} from '../schemas/contact.schema.js';

function actorCtx(req: FastifyRequest) {
  if (!req.authedUser) throw new UnauthorizedError();
  return {
    user: req.authedUser,
    ipAddress: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}

function workspaceId(req: FastifyRequest): string {
  if (!req.workspace) throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
  return req.workspace.id;
}

export const contactController = {
  // POST /api/v1/contacts
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = createContactBodySchema.parse(req.body);
    const contact = await req.server.services.contacts.createContact(workspaceId(req), body, actorCtx(req));
    return reply.status(201).send({ contact });
  },

  // PATCH /api/v1/contacts/:id
  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = contactIdParamSchema.parse(req.params);
    const body = updateContactBodySchema.parse(req.body);
    const contact = await req.server.services.contacts.updateContact(workspaceId(req), id, body, actorCtx(req));
    return reply.status(200).send({ contact });
  },

  // GET /api/v1/contacts
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = listContactsQuerySchema.parse(req.query);
    const result = await req.server.services.contacts.listContacts(workspaceId(req), query);
    return reply.status(200).send(result);
  },

  // GET /api/v1/contacts/:id
  async get(req: FastifyRequest, reply: FastifyReply) {
    const { id } = contactIdParamSchema.parse(req.params);
    const contact = await req.server.services.contacts.getContact(workspaceId(req), id);
    return reply.status(200).send({ contact });
  },

  // DELETE /api/v1/contacts/:id
  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = contactIdParamSchema.parse(req.params);
    await req.server.services.contacts.deleteContact(workspaceId(req), id, actorCtx(req));
    return reply.status(204).send();
  },

  // POST /api/v1/contacts/bulk-import
  async bulkImport(req: FastifyRequest, reply: FastifyReply) {
    const { contacts } = bulkImportBodySchema.parse(req.body);
    const result = await req.server.services.contacts.bulkImport(workspaceId(req), contacts, actorCtx(req));
    return reply.status(200).send(result);
  },

  // POST /api/v1/contacts/:id/suppress
  async suppress(req: FastifyRequest, reply: FastifyReply) {
    const { id } = contactIdParamSchema.parse(req.params);
    const contact = await req.server.services.contacts.suppressContact(workspaceId(req), id, actorCtx(req));
    return reply.status(200).send({ contact });
  },

  // POST /api/v1/contacts/:id/unsuppress
  async unsuppress(req: FastifyRequest, reply: FastifyReply) {
    const { id } = contactIdParamSchema.parse(req.params);
    const contact = await req.server.services.contacts.unsuppressContact(workspaceId(req), id, actorCtx(req));
    return reply.status(200).send({ contact });
  },
};
