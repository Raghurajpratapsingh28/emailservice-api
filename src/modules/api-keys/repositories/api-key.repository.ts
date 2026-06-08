import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { apiKeys, type ApiKey, type NewApiKey } from '@shared/database/schema/api-keys.js';
import type { Database } from '@shared/database/client.js';

export interface ListApiKeysFilter {
  workspaceId: string;
  page: number;
  pageSize: number;
}

export class ApiKeyRepository {
  public constructor(private readonly db: Database) {}

  public async insert(values: NewApiKey): Promise<ApiKey> {
    const rows = await this.db.insert(apiKeys).values(values).returning();
    return rows[0]!;
  }

  public async findById(workspaceId: string, id: string): Promise<ApiKey | null> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async findByHash(keyHash: string): Promise<ApiKey | null> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true), isNull(apiKeys.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async list(filter: ListApiKeysFilter): Promise<{ items: ApiKey[]; total: number }> {
    const offset = (filter.page - 1) * filter.pageSize;

    const [items, [row]] = await Promise.all([
      this.db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.workspaceId, filter.workspaceId), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt))
        .limit(filter.pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(apiKeys)
        .where(and(eq(apiKeys.workspaceId, filter.workspaceId), isNull(apiKeys.revokedAt))),
    ]);

    return { items, total: row?.total ?? 0 };
  }

  public async countActiveByWorkspace(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ c: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt), eq(apiKeys.isActive, true)));
    return Number(rows[0]?.c ?? 0);
  }

  public async revoke(workspaceId: string, id: string): Promise<ApiKey | null> {
    const rows = await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date(), isActive: false })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
      .returning();
    return rows[0] ?? null;
  }

  public async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }
}
