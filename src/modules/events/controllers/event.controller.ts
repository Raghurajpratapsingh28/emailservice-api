import type { FastifyReply, FastifyRequest } from 'fastify';
import { InternalServerError } from '@shared/errors/app-errors.js';
import { MAX_PAYLOAD_BYTES } from '../schemas/event.schema.js';
import {
  aliasBodySchema,
  debugQuerySchema,
  groupBodySchema,
  identifyBodySchema,
  pageBodySchema,
  trackBodySchema,
} from '../schemas/event.schema.js';

/**
 * Extracts the write key from either:
 *   - `x-write-key` header
 *   - `Authorization: Bearer wk_...` header
 */
function extractWriteKey(req: FastifyRequest): string | undefined {
  const header = req.headers['x-write-key'];
  if (typeof header === 'string' && header.length > 0) {
    return header.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return undefined;
}

/**
 * Enforces the 32 KB payload limit before Zod parsing.
 * Fastify's bodyLimit is set globally, but we want a tighter per-endpoint cap
 * with a typed error code.
 */
function assertPayloadSize(req: FastifyRequest): void {
  const raw = JSON.stringify(req.body);
  if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new InternalServerError('Payload too large');
  }
}

export const eventController = {
  // POST /track
  async track(req: FastifyRequest, reply: FastifyReply) {
    assertPayloadSize(req);
    const key = await req.server.services.events.resolveWriteKey(extractWriteKey(req));
    const body = trackBodySchema.parse(req.body);
    const result = await req.server.services.events.track(key, body, req.ip);
    return reply.status(202).send(result);
  },

  // POST /identify
  async identify(req: FastifyRequest, reply: FastifyReply) {
    assertPayloadSize(req);
    const key = await req.server.services.events.resolveWriteKey(extractWriteKey(req));
    const body = identifyBodySchema.parse(req.body);
    const result = await req.server.services.events.identify(key, body, req.ip);
    return reply.status(202).send(result);
  },

  // POST /page
  async page(req: FastifyRequest, reply: FastifyReply) {
    assertPayloadSize(req);
    const key = await req.server.services.events.resolveWriteKey(extractWriteKey(req));
    const body = pageBodySchema.parse(req.body);
    const result = await req.server.services.events.page(key, body, req.ip);
    return reply.status(202).send(result);
  },

  // POST /group
  async group(req: FastifyRequest, reply: FastifyReply) {
    assertPayloadSize(req);
    const key = await req.server.services.events.resolveWriteKey(extractWriteKey(req));
    const body = groupBodySchema.parse(req.body);
    const result = await req.server.services.events.group(key, body, req.ip);
    return reply.status(202).send(result);
  },

  // POST /alias
  async alias(req: FastifyRequest, reply: FastifyReply) {
    assertPayloadSize(req);
    const key = await req.server.services.events.resolveWriteKey(extractWriteKey(req));
    const body = aliasBodySchema.parse(req.body);
    const result = await req.server.services.events.alias(key, body, req.ip);
    return reply.status(202).send(result);
  },

  // GET /events/debug
  async debug(req: FastifyRequest, reply: FastifyReply) {
    const key = await req.server.services.events.resolveWriteKey(extractWriteKey(req));
    const query = debugQuerySchema.parse(req.query);
    const events = await req.server.services.events.getDebugEvents(key, query.limit);
    return reply.status(200).send({ events });
  },

  // GET /events/schemas
  async schemas(req: FastifyRequest, reply: FastifyReply) {
    const key = await req.server.services.events.resolveWriteKey(extractWriteKey(req));
    const schemas = await req.server.services.events.getEventSchemas(key);
    return reply.status(200).send({ schemas });
  },
};
