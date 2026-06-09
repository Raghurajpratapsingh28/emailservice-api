import { Counter } from 'prom-client';
import { eq } from 'drizzle-orm';
import { eventsRawSubject } from '@constants/nats-subjects.js';
import {
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '@shared/errors/app-errors.js';
import { workspaces } from '@shared/database/schema/workspaces.js';
import type { Database } from '@shared/database/client.js';
import type { Redis } from '@shared/cache/client.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { BillingService } from '@modules/billing/services/billing.service.js';
import type {
  AliasBody,
  GroupBody,
  IdentifyBody,
  PageBody,
  TrackBody,
} from '../schemas/event.schema.js';
import type { EventRepository } from '../repositories/event.repository.js';
import type { EventRaw, EventSchema } from '@shared/database/schema/events.js';
import type { ApiKey } from '@shared/database/schema/api-keys.js';

// ─── Metrics ─────────────────────────────────────────────────────────────────

const eventsAccepted = new Counter({
  name: 'events_ingestion_accepted_total',
  help: 'Events accepted and queued',
  labelNames: ['event_type'] as const,
});
const eventsRejected = new Counter({
  name: 'events_ingestion_rejected_total',
  help: 'Events rejected',
  labelNames: ['reason'] as const,
});
const eventsSchemaViolations = new Counter({
  name: 'events_schema_violations_total',
  help: 'Schema validation violations',
  labelNames: ['mode'] as const,
});
const eventsQueueFailures = new Counter({
  name: 'events_queue_publish_failures_total',
  help: 'NATS publish failures during event ingestion',
});
const eventsRateLimitHits = new Counter({
  name: 'events_rate_limit_hits_total',
  help: 'Rate limit triggers on event ingestion',
  labelNames: ['by'] as const,
});

// ─── Locked queue payload ────────────────────────────────────────────────────

interface EventQueuePayload {
  eventId: string;
  workspaceId: string;
  apiKeyId: string;
  eventType: string;
  eventName: string | null;
  userId: string | null;
  anonymousId: string | null;
  groupId: string | null;
  traits: Record<string, unknown>;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
  receivedAt: string;
}

// ─── Rate limit config ───────────────────────────────────────────────────────

const DEFAULT_RATE_LIMIT_PER_MINUTE = 1000;
const RATE_LIMIT_WINDOW_SECONDS = 60;

// ─── Service ─────────────────────────────────────────────────────────────────

export interface IngestResult {
  success: true;
  messageId: string;
}

export class EventService {
  public constructor(
    private readonly db: Database,
    private readonly repo: EventRepository,
    private readonly redis: Redis,
    private readonly nats: NatsClient,
    private readonly logger: {
      info: (...a: unknown[]) => void;
      warn: (...a: unknown[]) => void;
      error: (...a: unknown[]) => void;
    },
    private readonly billing: BillingService,
  ) {}

  // ─── Write-key auth ───────────────────────────────────────────────────────

  /**
   * Resolves and validates a write key from the request.
   * Returns the resolved ApiKey. Throws typed errors on failure.
   */
  public async resolveWriteKey(
    rawKey: string | undefined,
    requiredScope = 'events.write',
  ): Promise<ApiKey> {
    if (!rawKey || rawKey.trim().length === 0) {
      eventsRejected.inc({ reason: 'missing_key' });
      throw new UnauthorizedError('Missing write key', 'INVALID_WRITE_KEY');
    }

    const key = await this.repo.findActiveApiKey(rawKey.trim());
    if (!key) {
      eventsRejected.inc({ reason: 'invalid_key' });
      throw new UnauthorizedError('Invalid or revoked write key', 'INVALID_WRITE_KEY');
    }

    const scopes = key.scope.split(',').map((s) => s.trim());
    if (!scopes.includes(requiredScope)) {
      eventsRejected.inc({ reason: 'insufficient_scope' });
      throw new ForbiddenError('Write key lacks required scope', 'FORBIDDEN');
    }

    // Validate workspace is active
    const wsRows = await this.db
      .select({ status: workspaces.status })
      .from(workspaces)
      .where(eq(workspaces.id, key.workspaceId))
      .limit(1);
    const ws = wsRows[0];
    if (!ws || ws.status !== 'active') {
      eventsRejected.inc({ reason: 'workspace_inactive' });
      throw new ForbiddenError('Workspace is inactive', 'WORKSPACE_INACTIVE');
    }

    // Touch lastUsedAt (fire-and-forget)
    void this.repo.touchApiKey(key.id);

    return key;
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────

  /**
   * Enforces per-workspace + per-key + per-IP rate limits using Redis INCR.
   * Throws TooManyRequestsError if any limit is exceeded.
   */
  public async enforceRateLimit(
    workspaceId: string,
    apiKeyId: string,
    ip: string,
    keyRateLimit: number,
  ): Promise<void> {
    const limit = keyRateLimit > 0 ? keyRateLimit : DEFAULT_RATE_LIMIT_PER_MINUTE;
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / RATE_LIMIT_WINDOW_SECONDS);

    const checks: Array<{ key: string; max: number; by: string }> = [
      { key: `rl:events:ws:${workspaceId}:${window}`, max: limit, by: 'workspace' },
      { key: `rl:events:key:${apiKeyId}:${window}`, max: limit, by: 'api_key' },
      { key: `rl:events:ip:${ip}:${window}`, max: Math.max(limit * 2, 2000), by: 'ip' },
    ];

    const pipe = this.redis.pipeline();
    for (const c of checks) {
      pipe.incr(c.key);
      pipe.expire(c.key, RATE_LIMIT_WINDOW_SECONDS * 2, 'NX');
    }
    const results = await pipe.exec();
    if (!results) {
      return; // Redis unavailable — fail open
    }

    for (let i = 0; i < checks.length; i++) {
      const check = checks[i]!;
      const incrResult = results[i * 2];
      if (!incrResult) {
        continue;
      }
      const [err, value] = incrResult;
      if (err) {
        continue;
      }
      const count = typeof value === 'number' ? value : Number(value);
      if (count > check.max) {
        eventsRateLimitHits.inc({ by: check.by });
        this.logger.warn({ workspaceId, apiKeyId, by: check.by }, '[events] rate limit hit');
        throw new TooManyRequestsError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED');
      }
    }
  }

  // ─── 1. Track ─────────────────────────────────────────────────────────────

  public async track(
    key: ApiKey,
    body: TrackBody,
    ip: string,
  ): Promise<IngestResult> {
    await this.enforceRateLimit(key.workspaceId, key.id, ip, key.rateLimit);
    if (!await this.billing.hasQuotaRemaining(key.workspaceId, 'events', 1)) {
      throw new ForbiddenError('Event quota exceeded', 'QUOTA_EXCEEDED');
    }
    return this.ingest(key, {
      eventType: 'track',
      eventName: body.event,
      userId: body.userId ?? null,
      anonymousId: body.anonymousId ?? null,
      groupId: null,
      traits: {},
      properties: body.properties ?? {},
      context: body.context ?? {},
      timestamp: body.timestamp,
    });
  }

  // ─── 2. Identify ──────────────────────────────────────────────────────────

  public async identify(
    key: ApiKey,
    body: IdentifyBody,
    ip: string,
  ): Promise<IngestResult> {
    await this.enforceRateLimit(key.workspaceId, key.id, ip, key.rateLimit);
    if (!await this.billing.hasQuotaRemaining(key.workspaceId, 'events', 1)) {
      throw new ForbiddenError('Event quota exceeded', 'QUOTA_EXCEEDED');
    }
    return this.ingest(key, {
      eventType: 'identify',
      eventName: null,
      userId: body.userId ?? null,
      anonymousId: body.anonymousId ?? null,
      groupId: null,
      traits: body.traits ?? {},
      properties: {},
      context: body.context ?? {},
      timestamp: body.timestamp,
    });
  }

  // ─── 3. Page ──────────────────────────────────────────────────────────────

  public async page(
    key: ApiKey,
    body: PageBody,
    ip: string,
  ): Promise<IngestResult> {
    await this.enforceRateLimit(key.workspaceId, key.id, ip, key.rateLimit);
    if (!await this.billing.hasQuotaRemaining(key.workspaceId, 'events', 1)) {
      throw new ForbiddenError('Event quota exceeded', 'QUOTA_EXCEEDED');
    }
    return this.ingest(key, {
      eventType: 'page',
      eventName: 'Page Viewed',
      userId: body.userId ?? null,
      anonymousId: body.anonymousId ?? null,
      groupId: null,
      traits: {},
      properties: { ...(body.properties ?? {}), name: body.name ?? null },
      context: body.context ?? {},
      timestamp: body.timestamp,
    });
  }

  // ─── 4. Group ─────────────────────────────────────────────────────────────

  public async group(
    key: ApiKey,
    body: GroupBody,
    ip: string,
  ): Promise<IngestResult> {
    await this.enforceRateLimit(key.workspaceId, key.id, ip, key.rateLimit);
    if (!await this.billing.hasQuotaRemaining(key.workspaceId, 'events', 1)) {
      throw new ForbiddenError('Event quota exceeded', 'QUOTA_EXCEEDED');
    }
    return this.ingest(key, {
      eventType: 'group',
      eventName: null,
      userId: body.userId ?? null,
      anonymousId: body.anonymousId ?? null,
      groupId: body.groupId,
      traits: body.traits ?? {},
      properties: {},
      context: body.context ?? {},
      timestamp: body.timestamp,
    });
  }

  // ─── 5. Alias ─────────────────────────────────────────────────────────────

  public async alias(
    key: ApiKey,
    body: AliasBody,
    ip: string,
  ): Promise<IngestResult> {
    await this.enforceRateLimit(key.workspaceId, key.id, ip, key.rateLimit);
    if (!await this.billing.hasQuotaRemaining(key.workspaceId, 'events', 1)) {
      throw new ForbiddenError('Event quota exceeded', 'QUOTA_EXCEEDED');
    }
    return this.ingest(key, {
      eventType: 'alias',
      eventName: null,
      userId: body.userId,
      anonymousId: body.previousId,
      groupId: null,
      traits: {},
      properties: { previousId: body.previousId },
      context: body.context ?? {},
      timestamp: body.timestamp,
    });
  }

  // ─── Debug endpoints ──────────────────────────────────────────────────────

  public async getDebugEvents(
    key: ApiKey,
    limit: number,
  ): Promise<EventRaw[]> {
    return this.repo.listRecentEvents(key.workspaceId, limit);
  }

  public async getEventSchemas(key: ApiKey): Promise<EventSchema[]> {
    return this.repo.listEventSchemas(key.workspaceId);
  }

  // ─── Core ingest ──────────────────────────────────────────────────────────

  private async ingest(
    key: ApiKey,
    data: {
      eventType: string;
      eventName: string | null;
      userId: string | null;
      anonymousId: string | null;
      groupId: string | null;
      traits: Record<string, unknown>;
      properties: Record<string, unknown>;
      context: Record<string, unknown>;
      timestamp?: Date;
    },
  ): Promise<IngestResult> {
    const receivedAt = new Date();
    const normalizedTimestamp = data.timestamp ?? receivedAt;

    // Schema validation (only for track events with a name)
    let schemaViolations: string[] = [];
    if (data.eventType === 'track' && data.eventName) {
      const schema = await this.repo.findEventSchema(key.workspaceId, data.eventName);
      if (schema) {
        schemaViolations = this.validateAgainstSchema(data.properties, schema);
        if (schemaViolations.length > 0) {
          eventsSchemaViolations.inc({ mode: schema.validationMode });
          if (schema.validationMode === 'hard') {
            eventsRejected.inc({ reason: 'schema_violation_hard' });
            throw new ValidationError('Event schema violation', {
              code: 'EVENT_SCHEMA_VIOLATION',
              violations: schemaViolations,
            });
          }
          // soft: accept + log warning
          this.logger.warn(
            { workspaceId: key.workspaceId, eventName: data.eventName, schemaViolations },
            '[events] soft schema violation',
          );
        }
      }
    }

    // Persist
    const row = await this.repo.insertEvent({
      workspaceId: key.workspaceId,
      apiKeyId: key.id,
      eventType: data.eventType,
      eventName: data.eventName,
      userId: data.userId,
      anonymousId: data.anonymousId,
      groupId: data.groupId,
      traits: data.traits,
      properties: data.properties,
      context: data.context,
      receivedAt,
      originalTimestamp: data.timestamp ?? null,
      normalizedTimestamp,
      status: schemaViolations.length > 0 ? 'schema_violation' : 'pending',
    });

    // Write debug log if there were soft violations
    if (schemaViolations.length > 0) {
      await this.repo
        .insertDebugLog({
          workspaceId: key.workspaceId,
          eventId: row.id,
          validationErrors: schemaViolations,
          processingNotes: [],
        })
        .catch((err) =>
          this.logger.warn({ err }, '[events] debug log write failed'),
        );
    }

    // Publish locked queue contract
    const payload: EventQueuePayload = {
      eventId: row.id,
      workspaceId: key.workspaceId,
      apiKeyId: key.id,
      eventType: data.eventType,
      eventName: data.eventName,
      userId: data.userId,
      anonymousId: data.anonymousId,
      groupId: data.groupId,
      traits: data.traits,
      properties: data.properties,
      context: data.context,
      receivedAt: receivedAt.toISOString(),
    };

    try {
      await this.nats.publish(eventsRawSubject(key.workspaceId), payload);
    } catch (err) {
      eventsQueueFailures.inc();
      this.logger.error(
        { err, workspaceId: key.workspaceId, eventId: row.id },
        '[events] queue publish failed; rolling back event row',
      );
      await this.repo.deleteEventById(row.id).catch(() => undefined);
      throw new Error('Failed to queue event');
    }

    await this.billing.recordUsage(key.workspaceId, 'events', 1);
    eventsAccepted.inc({ event_type: data.eventType });
    this.logger.info(
      { workspaceId: key.workspaceId, eventType: data.eventType, eventId: row.id },
      '[events] accepted',
    );

    return { success: true, messageId: row.id };
  }

  // ─── Schema validation ────────────────────────────────────────────────────

  /**
   * Minimal JSON Schema-style validation against the stored schema definition.
   * We check required fields and basic type constraints. A full JSON Schema
   * validator (e.g. ajv) can be swapped in here without changing the interface.
   */
  private validateAgainstSchema(
    properties: Record<string, unknown>,
    schema: EventSchema,
  ): string[] {
    const violations: string[] = [];
    const def = schema.schemaDefinition as Record<string, unknown>;

    const required = Array.isArray(def.required) ? (def.required as string[]) : [];
    for (const field of required) {
      if (!(field in properties) || properties[field] === null || properties[field] === undefined) {
        violations.push(`Missing required field: ${field}`);
      }
    }

    const props = (def.properties ?? {}) as Record<string, { type?: string }>;
    for (const [field, spec] of Object.entries(props)) {
      if (!(field in properties)) {
        continue;
      }
      const value = properties[field];
      if (spec.type && value !== null && value !== undefined) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== spec.type) {
          violations.push(
            `Field '${field}' expected type '${spec.type}', got '${actualType}'`,
          );
        }
      }
    }

    return violations;
  }
}
