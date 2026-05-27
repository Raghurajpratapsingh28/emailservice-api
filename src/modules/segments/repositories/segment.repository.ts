import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  segmentMemberships,
  segments,
  type NewSegment,
  type NewSegmentMembership,
  type Segment,
} from '@shared/database/schema/segments.js';
import { contacts } from '@shared/database/schema/contacts.js';
import type { Database } from '@shared/database/client.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export class SegmentRepository {
  public constructor(private readonly db: Database) {}

  public async insert(values: NewSegment): Promise<Segment> {
    const rows = await this.db.insert(segments).values(values).returning();
    return rows[0]!;
  }

  public async findById(workspaceId: string, id: string): Promise<Segment | null> {
    const rows = await this.db
      .select()
      .from(segments)
      .where(and(eq(segments.id, id), eq(segments.workspaceId, workspaceId), isNull(segments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async list(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: Segment[]; total: number }> {
    const conds = [eq(segments.workspaceId, workspaceId), isNull(segments.deletedAt)];
    const offset = (page - 1) * pageSize;
    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(segments)
        .where(and(...conds))
        .orderBy(desc(segments.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ c: count() }).from(segments).where(and(...conds)),
    ]);
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  public async update(
    workspaceId: string,
    id: string,
    patch: Partial<Omit<Segment, 'id' | 'workspaceId' | 'createdAt'>>,
  ): Promise<Segment | null> {
    const rows = await this.db
      .update(segments)
      .set(patch)
      .where(and(eq(segments.id, id), eq(segments.workspaceId, workspaceId), isNull(segments.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  public async softDelete(workspaceId: string, id: string): Promise<Segment | null> {
    const rows = await this.db
      .update(segments)
      .set({ deletedAt: new Date() })
      .where(and(eq(segments.id, id), eq(segments.workspaceId, workspaceId), isNull(segments.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  // ─── Memberships ──────────────────────────────────────────────────────────

  public async getPreviewContacts(
    workspaceId: string,
    segmentId: string,
    limit: number,
  ) {
    return this.db
      .select({ contact: contacts })
      .from(segmentMemberships)
      .innerJoin(contacts, eq(segmentMemberships.contactId, contacts.id))
      .where(
        and(
          eq(segmentMemberships.segmentId, segmentId),
          eq(segmentMemberships.workspaceId, workspaceId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(limit);
  }

  public async replaceMemberships(
    tx: Tx | Database,
    workspaceId: string,
    segmentId: string,
    contactIds: string[],
  ): Promise<void> {
    await tx
      .delete(segmentMemberships)
      .where(eq(segmentMemberships.segmentId, segmentId));

    if (contactIds.length === 0) return;

    const values: NewSegmentMembership[] = contactIds.map((contactId) => ({
      workspaceId,
      segmentId,
      contactId,
    }));
    await tx.insert(segmentMemberships).values(values).onConflictDoNothing();
  }

  public async getMembershipCount(segmentId: string): Promise<number> {
    const rows = await this.db
      .select({ c: count() })
      .from(segmentMemberships)
      .where(eq(segmentMemberships.segmentId, segmentId));
    return Number(rows[0]?.c ?? 0);
  }

  public async getContactSegmentSummary(
    workspaceId: string,
    contactId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({ id: segments.id, name: segments.name })
      .from(segmentMemberships)
      .innerJoin(segments, eq(segmentMemberships.segmentId, segments.id))
      .where(
        and(
          eq(segmentMemberships.contactId, contactId),
          eq(segmentMemberships.workspaceId, workspaceId),
          isNull(segments.deletedAt),
        ),
      );
  }
}
