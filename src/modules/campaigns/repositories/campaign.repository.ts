import { and, asc, count, desc, eq, gte, ilike, isNull, lte, sql } from 'drizzle-orm';
import {
  campaignRecipients,
  campaigns,
  type Campaign,
  type CampaignRecipient,
  type CampaignStatus,
  type CampaignType,
  type NewCampaign,
  type NewCampaignRecipient,
} from '@shared/database/schema/campaigns.js';
import {
  segments,
  type Segment,
} from '@shared/database/schema/segments.js';
import type { Database } from '@shared/database/client.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ListCampaignsFilter {
  workspaceId: string;
  status?: CampaignStatus;
  type?: CampaignType;
  search?: string;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

/**
 * Campaign data-access layer.
 *
 * Tenant isolation invariants:
 *   - Every read/write on a single campaign pairs `id` with `workspaceId` in WHERE.
 *   - Soft-deleted rows excluded by default (`includeDeleted` opt-in).
 *   - Status-state-machine guarded updates use `WHERE status IN (allowed)` so
 *     concurrent transitions cannot race past each other.
 */
export class CampaignRepository {
  public constructor(private readonly db: Database) {}

  // ─── Campaign CRUD ────────────────────────────────────────────────────────

  public async insert(tx: Tx | Database, values: NewCampaign): Promise<Campaign> {
    const rows = await tx.insert(campaigns).values(values).returning();
    return rows[0]!;
  }

  public async findById(
    workspaceId: string,
    campaignId: string,
    includeDeleted = false,
  ): Promise<Campaign | null> {
    const conds = [
      eq(campaigns.id, campaignId),
      eq(campaigns.workspaceId, workspaceId),
    ];
    if (!includeDeleted) {
      conds.push(isNull(campaigns.deletedAt));
    }
    const rows = await this.db.select().from(campaigns).where(and(...conds)).limit(1);
    return rows[0] ?? null;
  }

  public async findByName(
    workspaceId: string,
    name: string,
  ): Promise<Campaign | null> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.workspaceId, workspaceId),
          eq(campaigns.name, name),
          isNull(campaigns.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  public async list(
    filter: ListCampaignsFilter,
  ): Promise<{ items: Campaign[]; total: number }> {
    const conds = [
      eq(campaigns.workspaceId, filter.workspaceId),
      isNull(campaigns.deletedAt),
    ];
    if (filter.status) {
      conds.push(eq(campaigns.status, filter.status));
    }
    if (filter.type) {
      conds.push(eq(campaigns.type, filter.type));
    }
    if (filter.search) {
      conds.push(ilike(campaigns.name, `%${filter.search}%`));
    }
    if (filter.fromDate) {
      conds.push(gte(campaigns.createdAt, filter.fromDate));
    }
    if (filter.toDate) {
      conds.push(lte(campaigns.createdAt, filter.toDate));
    }
    const offset = (filter.page - 1) * filter.pageSize;

    const itemsP = this.db
      .select()
      .from(campaigns)
      .where(and(...conds))
      .orderBy(desc(campaigns.createdAt))
      .limit(filter.pageSize)
      .offset(offset);

    const totalP = this.db
      .select({ c: count() })
      .from(campaigns)
      .where(and(...conds));

    const [items, totalRows] = await Promise.all([itemsP, totalP]);
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  /**
   * Optimistic-concurrency content update. Allowed only when the campaign is in
   * one of the editable statuses (default: ['draft']) AND the version matches.
   * Returns null on miss → service maps to 409.
   */
  public async updateContent(
    workspaceId: string,
    campaignId: string,
    expectedVersion: number,
    allowedStatuses: readonly CampaignStatus[],
    patch: Partial<
      Pick<
        Campaign,
        | 'name'
        | 'subject'
        | 'previewText'
        | 'senderEmail'
        | 'senderName'
        | 'replyTo'
        | 'htmlBody'
        | 'textBody'
        | 'templateId'
        | 'segmentId'
      >
    >,
  ): Promise<Campaign | null> {
    if (allowedStatuses.length === 0) {
      return null;
    }
    const rows = await this.db
      .update(campaigns)
      .set({ ...patch, version: sql`${campaigns.version} + 1` })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.workspaceId, workspaceId),
          eq(campaigns.version, expectedVersion),
          isNull(campaigns.deletedAt),
          this.statusIn(allowedStatuses),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Status-transition update. Pass the allowed source statuses; if the row is
   * not in one of them, returns null and the service translates to
   * INVALID_CAMPAIGN_STATE.
   */
  public async transitionStatus(
    workspaceId: string,
    campaignId: string,
    fromStatuses: readonly CampaignStatus[],
    toStatus: CampaignStatus,
    extra: Partial<
      Pick<
        Campaign,
        | 'scheduledAt'
        | 'startedAt'
        | 'completedAt'
        | 'pausedAt'
        | 'recipientCount'
        | 'sendMetadata'
      >
    > = {},
  ): Promise<Campaign | null> {
    if (fromStatuses.length === 0) {
      return null;
    }
    const rows = await this.db
      .update(campaigns)
      .set({
        status: toStatus,
        ...extra,
        version: sql`${campaigns.version} + 1`,
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.workspaceId, workspaceId),
          isNull(campaigns.deletedAt),
          this.statusIn(fromStatuses),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Status-transition with an additional optimistic-concurrency check.
   */
  public async transitionStatusWithVersion(
    workspaceId: string,
    campaignId: string,
    expectedVersion: number,
    fromStatuses: readonly CampaignStatus[],
    toStatus: CampaignStatus,
    extra: Partial<Campaign> = {},
  ): Promise<Campaign | null> {
    const rows = await this.db
      .update(campaigns)
      .set({ status: toStatus, ...extra, version: sql`${campaigns.version} + 1` })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.workspaceId, workspaceId),
          eq(campaigns.version, expectedVersion),
          isNull(campaigns.deletedAt),
          this.statusIn(fromStatuses),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  public async softDelete(
    workspaceId: string,
    campaignId: string,
  ): Promise<Campaign | null> {
    const rows = await this.db
      .update(campaigns)
      .set({
        status: 'cancelled',
        deletedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.workspaceId, workspaceId),
          isNull(campaigns.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  // ─── Segment lookup ───────────────────────────────────────────────────────

  /**
   * Workspace-scoped segment lookup. The campaigns service uses this to verify
   * a segment belongs to the same workspace before binding it to a campaign.
   */
  public async findSegment(
    workspaceId: string,
    segmentId: string,
  ): Promise<Segment | null> {
    const rows = await this.db
      .select()
      .from(segments)
      .where(
        and(
          eq(segments.id, segmentId),
          eq(segments.workspaceId, workspaceId),
          isNull(segments.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // ─── Recipients ──────────────────────────────────────────────────────────

  public async insertRecipientsTx(
    tx: Tx,
    rows: readonly NewCampaignRecipient[],
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    // ON CONFLICT DO NOTHING on (campaignId, email) — defends against
    // concurrent send-now requests for the same campaign (only one wins
    // overall via the status transition; this is belt-and-suspenders).
    await tx.insert(campaignRecipients).values([...rows]).onConflictDoNothing({
      target: [campaignRecipients.campaignId, campaignRecipients.email],
    });
    return rows.length;
  }

  public async countRecipients(workspaceId: string, campaignId: string): Promise<number> {
    const rows = await this.db
      .select({ c: count() })
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.workspaceId, workspaceId),
          eq(campaignRecipients.campaignId, campaignId),
        ),
      );
    return Number(rows[0]?.c ?? 0);
  }

  public async listRecipients(
    workspaceId: string,
    campaignId: string,
    limit = 100,
    offset = 0,
  ): Promise<CampaignRecipient[]> {
    return this.db
      .select()
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.workspaceId, workspaceId),
          eq(campaignRecipients.campaignId, campaignId),
        ),
      )
      .orderBy(asc(campaignRecipients.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * Drizzle's `inArray` works here too, but a hand-written disjunction is
   * cleaner against the small fixed set of statuses we care about.
   */
  private statusIn(statuses: readonly CampaignStatus[]) {
    if (statuses.length === 1) {
      return eq(campaigns.status, statuses[0]!);
    }
    return sql`${campaigns.status} IN (${sql.join(
      statuses.map((s) => sql`${s}`),
      sql`, `,
    )})`;
  }
}
