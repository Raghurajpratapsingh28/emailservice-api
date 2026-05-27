import { and, desc, eq, isNull } from 'drizzle-orm';
import { sha256 } from '@shared/utils/crypto.js';
import {
  apiKeys,
  eventDebugLogs,
  eventSchemas,
  eventsRaw,
  type ApiKey,
  type EventDebugLog,
  type EventRaw,
  type EventSchema,
  type NewEventDebugLog,
  type NewEventRaw,
} from '@shared/database/schema/index.js';
import type { Database } from '@shared/database/client.js';

/**
 * Event ingestion data-access layer.
 *
 * Tenant isolation:
 *   - API key lookup resolves workspaceId from the key itself — callers cannot
 *     supply a workspaceId directly.
 *   - Every subsequent query pairs the resolved workspaceId in WHERE.
 */
export class EventRepository {
  public constructor(private readonly db: Database) {}

  // ─── API key auth ─────────────────────────────────────────────────────────

  /**
   * Resolves an API key from its plaintext value.
   * Returns null if not found, revoked, or inactive.
   */
  public async findActiveApiKey(plaintextKey: string): Promise<ApiKey | null> {
    const hash = sha256(plaintextKey);
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyHash, hash),
          eq(apiKeys.isActive, true),
          isNull(apiKeys.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Bumps lastUsedAt — fire-and-forget, never throws. */
  public async touchApiKey(apiKeyId: string): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, apiKeyId))
      .catch(() => undefined);
  }

  // ─── Event writes ─────────────────────────────────────────────────────────

  public async insertEvent(values: NewEventRaw): Promise<EventRaw> {
    const rows = await this.db.insert(eventsRaw).values(values).returning();
    return rows[0]!;
  }

  public async deleteEventById(eventId: string): Promise<void> {
    await this.db.delete(eventsRaw).where(eq(eventsRaw.id, eventId));
  }

  public async insertDebugLog(values: NewEventDebugLog): Promise<EventDebugLog> {
    const rows = await this.db.insert(eventDebugLogs).values(values).returning();
    return rows[0]!;
  }

  // ─── Schema validation ────────────────────────────────────────────────────

  public async findEventSchema(
    workspaceId: string,
    eventName: string,
  ): Promise<EventSchema | null> {
    const rows = await this.db
      .select()
      .from(eventSchemas)
      .where(
        and(
          eq(eventSchemas.workspaceId, workspaceId),
          eq(eventSchemas.eventName, eventName),
          eq(eventSchemas.isActive, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  public async listEventSchemas(workspaceId: string): Promise<EventSchema[]> {
    return this.db
      .select()
      .from(eventSchemas)
      .where(
        and(
          eq(eventSchemas.workspaceId, workspaceId),
          eq(eventSchemas.isActive, true),
        ),
      )
      .orderBy(desc(eventSchemas.createdAt));
  }

  // ─── Debug ────────────────────────────────────────────────────────────────

  public async listRecentEvents(
    workspaceId: string,
    limit = 50,
  ): Promise<EventRaw[]> {
    return this.db
      .select()
      .from(eventsRaw)
      .where(eq(eventsRaw.workspaceId, workspaceId))
      .orderBy(desc(eventsRaw.receivedAt))
      .limit(Math.min(limit, 200));
  }
}
