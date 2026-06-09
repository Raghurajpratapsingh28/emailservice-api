import { and, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import {
  contactTags,
  contacts,
  type Contact,
  type NewContact,
  type NewContactTag,
} from '@shared/database/schema/contacts.js';
import type { Database } from '@shared/database/client.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ListContactsFilter {
  workspaceId: string;
  search?: string;
  tags?: string[];
  lifecycleStage?: string;
  emailSuppressed?: boolean;
  unsubscribed?: boolean;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

export class ContactRepository {
  public constructor(private readonly db: Database) {}

  public async insert(tx: Tx | Database, values: NewContact): Promise<Contact> {
    const rows = await tx.insert(contacts).values(values).returning();
    return rows[0]!;
  }

  public async insertBulk(
    tx: Tx | Database,
    values: NewContact[],
  ): Promise<Contact[]> {
    if (values.length === 0) return [];
    return tx
      .insert(contacts)
      .values(values)
      .onConflictDoNothing({ target: [contacts.workspaceId, contacts.email] })
      .returning();
  }

  public async findById(workspaceId: string, id: string): Promise<Contact | null> {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async findByEmail(workspaceId: string, email: string): Promise<Contact | null> {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.email, email.toLowerCase()),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  public async list(filter: ListContactsFilter): Promise<{ items: Contact[]; total: number }> {
    const conds = [eq(contacts.workspaceId, filter.workspaceId), isNull(contacts.deletedAt)];

    if (filter.search) {
      conds.push(
        sql`(${ilike(contacts.email, `%${filter.search}%`)} OR ${ilike(contacts.firstName, `%${filter.search}%`)} OR ${ilike(contacts.lastName, `%${filter.search}%`)})`,
      );
    }
    if (filter.lifecycleStage) {
      conds.push(eq(contacts.lifecycleStage, filter.lifecycleStage));
    }
    if (filter.emailSuppressed !== undefined) {
      conds.push(eq(contacts.emailSuppressed, filter.emailSuppressed));
    }
    if (filter.unsubscribed !== undefined) {
      conds.push(eq(contacts.unsubscribed, filter.unsubscribed));
    }
    if (filter.fromDate) {
      conds.push(sql`${contacts.createdAt} >= ${filter.fromDate}`);
    }
    if (filter.toDate) {
      conds.push(sql`${contacts.createdAt} <= ${filter.toDate}`);
    }

    // Tag filter: contacts that have ALL specified tags
    if (filter.tags && filter.tags.length > 0) {
      const taggedContactIds = await this.db
        .select({ contactId: contactTags.contactId })
        .from(contactTags)
        .where(
          and(
            eq(contactTags.workspaceId, filter.workspaceId),
            inArray(contactTags.tag, filter.tags),
          ),
        )
        .groupBy(contactTags.contactId)
        .having(sql`count(distinct ${contactTags.tag}) = ${filter.tags.length}`);

      if (taggedContactIds.length === 0) {
        return { items: [], total: 0 };
      }
      conds.push(inArray(contacts.id, taggedContactIds.map((r) => r.contactId)));
    }

    const offset = (filter.page - 1) * filter.pageSize;
    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(contacts)
        .where(and(...conds))
        .orderBy(desc(contacts.createdAt))
        .limit(filter.pageSize)
        .offset(offset),
      this.db.select({ c: count() }).from(contacts).where(and(...conds)),
    ]);

    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  public async update(
    workspaceId: string,
    id: string,
    patch: Partial<Omit<Contact, 'id' | 'workspaceId' | 'createdAt'>>,
  ): Promise<Contact | null> {
    const rows = await this.db
      .update(contacts)
      .set(patch)
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  public async softDelete(workspaceId: string, id: string): Promise<Contact | null> {
    const rows = await this.db
      .update(contacts)
      .set({ deletedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  public async countByWorkspace(workspaceId: string, tx?: Tx | Database): Promise<number> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ c: count() })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)));
    return Number(rows[0]?.c ?? 0);
  }

  // ─── Tags ─────────────────────────────────────────────────────────────────

  public async getTagsForContact(contactId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tag: contactTags.tag })
      .from(contactTags)
      .where(eq(contactTags.contactId, contactId));
    return rows.map((r) => r.tag);
  }

  public async getTagsForContacts(contactIds: string[]): Promise<Map<string, string[]>> {
    if (contactIds.length === 0) return new Map();
    const rows = await this.db
      .select({ contactId: contactTags.contactId, tag: contactTags.tag })
      .from(contactTags)
      .where(inArray(contactTags.contactId, contactIds));
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const arr = map.get(row.contactId) ?? [];
      arr.push(row.tag);
      map.set(row.contactId, arr);
    }
    return map;
  }

  public async replaceTags(
    tx: Tx | Database,
    workspaceId: string,
    contactId: string,
    tags: string[],
  ): Promise<void> {
    await tx.delete(contactTags).where(eq(contactTags.contactId, contactId));
    if (tags.length === 0) return;
    const values: NewContactTag[] = tags.map((tag) => ({ workspaceId, contactId, tag }));
    await tx.insert(contactTags).values(values).onConflictDoNothing();
  }

  public async addTags(
    workspaceId: string,
    contactId: string,
    tags: string[],
  ): Promise<void> {
    if (tags.length === 0) return;
    const values: NewContactTag[] = tags.map((tag) => ({ workspaceId, contactId, tag }));
    await this.db.insert(contactTags).values(values).onConflictDoNothing();
  }

  public async removeTags(contactId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    await this.db
      .delete(contactTags)
      .where(and(eq(contactTags.contactId, contactId), inArray(contactTags.tag, tags)));
  }
}
