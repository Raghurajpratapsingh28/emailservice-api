import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  domains,
  type Domain,
  type DomainStatus,
  type NewDomain,
} from '@shared/database/schema/domains.js';
import type { Database } from '@shared/database/client.js';
import { ConflictError } from '@shared/errors/app-errors.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  return msg.includes('duplicate key value violates unique constraint');
}

export interface ListDomainsFilter {
  workspaceId: string;
  status?: DomainStatus;
  page: number;
  pageSize: number;
}

/**
 * Domain data-access layer.
 *
 * Tenant isolation invariants:
 *   - Every read/write that targets a specific row pairs the row id with
 *     `workspaceId` in the WHERE clause.
 *   - Soft-deleted rows are excluded by default (`includeDeleted` flag opt-in).
 */
export class DomainRepository {
  public constructor(private readonly db: Database) {}

  // ─── Inserts ──────────────────────────────────────────────────────────────

  public async insert(tx: Tx | Database, values: NewDomain): Promise<Domain> {
    try {
      const rows = await tx.insert(domains).values(values).returning();
      return rows[0]!;
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('Domain already exists for this workspace', 'DOMAIN_ALREADY_EXISTS');
      }
      throw err;
    }
  }

  // ─── Lookups ──────────────────────────────────────────────────────────────

  public async findById(
    workspaceId: string,
    domainId: string,
    includeDeleted = false,
  ): Promise<Domain | null> {
    const conds = [
      eq(domains.id, domainId),
      eq(domains.workspaceId, workspaceId),
    ];
    if (!includeDeleted) {
      conds.push(isNull(domains.deletedAt));
    }
    const rows = await this.db.select().from(domains).where(and(...conds)).limit(1);
    return rows[0] ?? null;
  }

  public async findByDomain(
    workspaceId: string,
    domain: string,
    includeDeleted = false,
  ): Promise<Domain | null> {
    const conds = [
      eq(domains.workspaceId, workspaceId),
      eq(domains.domain, domain),
    ];
    if (!includeDeleted) {
      conds.push(isNull(domains.deletedAt));
    }
    const rows = await this.db.select().from(domains).where(and(...conds)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Returns true if any OTHER workspace has an active (non-deleted) row for
   * this domain. Used to block cross-workspace domain squatting.
   */
  public async isClaimedByAnotherWorkspace(workspaceId: string, domain: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: domains.id })
      .from(domains)
      .where(
        and(
          eq(domains.domain, domain),
          isNull(domains.deletedAt),
          sql`${domains.workspaceId} != ${workspaceId}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // ─── Listing ──────────────────────────────────────────────────────────────

  public async list(filter: ListDomainsFilter): Promise<{ items: Domain[]; total: number }> {
    const conds = [
      eq(domains.workspaceId, filter.workspaceId),
      isNull(domains.deletedAt),
    ];
    if (filter.status) {
      conds.push(eq(domains.status, filter.status));
    }
    const offset = (filter.page - 1) * filter.pageSize;

    const itemsP = this.db
      .select()
      .from(domains)
      .where(and(...conds))
      .orderBy(desc(domains.createdAt), asc(domains.domain))
      .limit(filter.pageSize)
      .offset(offset);

    const totalP = this.db
      .select({ c: count() })
      .from(domains)
      .where(and(...conds));

    const [items, totalRows] = await Promise.all([itemsP, totalP]);
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  public async countByWorkspace(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ c: count() })
      .from(domains)
      .where(and(eq(domains.workspaceId, workspaceId), isNull(domains.deletedAt)));
    return Number(rows[0]?.c ?? 0);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  /**
   * Conditional update with optimistic concurrency. Returns null if the row
   * is gone, soft-deleted, or the version doesn't match.
   */
  public async updateWithVersion(
    workspaceId: string,
    domainId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        Domain,
        | 'status'
        | 'dkimTokens'
        | 'sesIdentityArn'
        | 'verificationStartedAt'
        | 'verifiedAt'
        | 'lastVerificationCheckAt'
        | 'verificationAttempts'
        | 'deletedAt'
      >
    >,
  ): Promise<Domain | null> {
    const rows = await this.db
      .update(domains)
      .set({
        ...patch,
        version: sql`${domains.version} + 1`,
      })
      .where(
        and(
          eq(domains.id, domainId),
          eq(domains.workspaceId, workspaceId),
          eq(domains.version, expectedVersion),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Hard delete inside a transaction (rollback path on SES failure during create).
   */
  public async deleteByIdTx(
    tx: Tx,
    workspaceId: string,
    domainId: string,
  ): Promise<void> {
    await tx
      .delete(domains)
      .where(and(eq(domains.id, domainId), eq(domains.workspaceId, workspaceId)));
  }

  /**
   * Soft delete: marks `deletedAt` and `status='deleted'`.
   */
  public async softDelete(
    workspaceId: string,
    domainId: string,
    expectedVersion: number,
  ): Promise<Domain | null> {
    const rows = await this.db
      .update(domains)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        version: sql`${domains.version} + 1`,
      })
      .where(
        and(
          eq(domains.id, domainId),
          eq(domains.workspaceId, workspaceId),
          eq(domains.version, expectedVersion),
          isNull(domains.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
