import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import {
  emailSends,
  emailTemplates,
  type EmailSend,
  type EmailSendStatus,
  type EmailTemplate,
  type EmailTemplateStatus,
  type NewEmailSend,
  type NewEmailTemplate,
} from '@shared/database/schema/emails.js';
import type { Database } from '@shared/database/client.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ListSendsFilter {
  workspaceId: string;
  status?: EmailSendStatus;
  recipientSearch?: string;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

export interface ListTemplatesFilter {
  workspaceId: string;
  status?: EmailTemplateStatus;
  search?: string;
  /** When true, return only the latest version per template name. */
  latestOnly?: boolean;
  page: number;
  pageSize: number;
}

export interface QuotaWindow {
  workspaceId: string;
  since: Date;
}

/**
 * Workspace-scoped data access for transactional emails + templates.
 *
 * Tenant invariants:
 *   - Every method that returns or mutates a single row pairs the row id with
 *     `workspaceId` in the WHERE clause.
 *   - Soft-deleted templates are excluded from default queries.
 */
export class TransactionalRepository {
  public constructor(private readonly db: Database) {}

  // ─── Email sends ──────────────────────────────────────────────────────────

  public async insertSend(tx: Tx | Database, values: NewEmailSend): Promise<EmailSend> {
    const rows = await tx.insert(emailSends).values(values).returning();
    return rows[0]!;
  }

  public async findSendBySendId(workspaceId: string, sendId: string): Promise<EmailSend | null> {
    const rows = await this.db
      .select()
      .from(emailSends)
      .where(and(eq(emailSends.workspaceId, workspaceId), eq(emailSends.sendId, sendId)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async findSendByIdInternal(
    workspaceId: string,
    id: string,
  ): Promise<EmailSend | null> {
    const rows = await this.db
      .select()
      .from(emailSends)
      .where(and(eq(emailSends.workspaceId, workspaceId), eq(emailSends.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async listSends(
    filter: ListSendsFilter,
  ): Promise<{ items: EmailSend[]; total: number }> {
    const conds = [eq(emailSends.workspaceId, filter.workspaceId)];
    if (filter.status) {
      conds.push(eq(emailSends.status, filter.status));
    }
    if (filter.recipientSearch) {
      conds.push(ilike(emailSends.recipientEmail, `%${filter.recipientSearch}%`));
    }
    if (filter.fromDate) {
      conds.push(gte(emailSends.createdAt, filter.fromDate));
    }
    if (filter.toDate) {
      conds.push(lte(emailSends.createdAt, filter.toDate));
    }

    const offset = (filter.page - 1) * filter.pageSize;

    const itemsP = this.db
      .select()
      .from(emailSends)
      .where(and(...conds))
      .orderBy(desc(emailSends.createdAt))
      .limit(filter.pageSize)
      .offset(offset);

    const totalP = this.db
      .select({ c: count() })
      .from(emailSends)
      .where(and(...conds));

    const [items, totalRows] = await Promise.all([itemsP, totalP]);
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  /**
   * Counts sends in a workspace within a time window — used by the quota guard.
   */
  public async countSendsSince(window: QuotaWindow): Promise<number> {
    const rows = await this.db
      .select({ c: count() })
      .from(emailSends)
      .where(
        and(
          eq(emailSends.workspaceId, window.workspaceId),
          gte(emailSends.createdAt, window.since),
        ),
      );
    return Number(rows[0]?.c ?? 0);
  }

  /**
   * Tx-scoped delete used as the rollback path when NATS publish fails.
   */
  public async deleteSendByIdTx(
    tx: Tx,
    workspaceId: string,
    id: string,
  ): Promise<void> {
    await tx
      .delete(emailSends)
      .where(and(eq(emailSends.workspaceId, workspaceId), eq(emailSends.id, id)));
  }

  // ─── Email templates ──────────────────────────────────────────────────────

  public async insertTemplate(
    tx: Tx | Database,
    values: NewEmailTemplate,
  ): Promise<EmailTemplate> {
    const rows = await tx.insert(emailTemplates).values(values).returning();
    return rows[0]!;
  }

  public async findTemplateById(
    workspaceId: string,
    templateId: string,
    includeDeleted = false,
  ): Promise<EmailTemplate | null> {
    const conds = [
      eq(emailTemplates.workspaceId, workspaceId),
      eq(emailTemplates.id, templateId),
    ];
    if (!includeDeleted) {
      conds.push(isNull(emailTemplates.deletedAt));
    }
    const rows = await this.db.select().from(emailTemplates).where(and(...conds)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Returns the latest non-deleted version of a template by name within the
   * workspace. Used by the send service to lock the version at queue time.
   */
  public async findLatestByName(
    workspaceId: string,
    name: string,
  ): Promise<EmailTemplate | null> {
    const rows = await this.db
      .select()
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.name, name),
          isNull(emailTemplates.deletedAt),
        ),
      )
      .orderBy(desc(emailTemplates.version))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Updates a draft template. Published templates are immutable — callers
   * must invoke `cloneAsDraftNextVersion` if they want to change a published
   * template; that path lives in the service.
   */
  public async updateTemplate(
    workspaceId: string,
    templateId: string,
    patch: Partial<
      Pick<EmailTemplate, 'name' | 'subject' | 'htmlBody' | 'textBody' | 'variables' | 'status'>
    >,
  ): Promise<EmailTemplate | null> {
    const rows = await this.db
      .update(emailTemplates)
      .set(patch)
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.id, templateId),
          isNull(emailTemplates.deletedAt),
          // Drafts only — published rows are immutable
          eq(emailTemplates.status, 'draft'),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Marks a draft as published. Returns null if template was already published or not found. */
  public async publishTemplate(
    workspaceId: string,
    templateId: string,
  ): Promise<EmailTemplate | null> {
    const rows = await this.db
      .update(emailTemplates)
      .set({ status: 'published' })
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.id, templateId),
          eq(emailTemplates.status, 'draft'),
          isNull(emailTemplates.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /** Soft delete — sets deletedAt + status='archived'. */
  public async softDeleteTemplate(
    workspaceId: string,
    templateId: string,
  ): Promise<EmailTemplate | null> {
    const rows = await this.db
      .update(emailTemplates)
      .set({ status: 'archived', deletedAt: new Date() })
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.id, templateId),
          isNull(emailTemplates.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  public async listTemplates(
    filter: ListTemplatesFilter,
  ): Promise<{ items: EmailTemplate[]; total: number }> {
    const conds = [
      eq(emailTemplates.workspaceId, filter.workspaceId),
      isNull(emailTemplates.deletedAt),
    ];
    if (filter.status) {
      conds.push(eq(emailTemplates.status, filter.status));
    }
    if (filter.search) {
      const term = `%${filter.search}%`;
      conds.push(or(ilike(emailTemplates.name, term), ilike(emailTemplates.subject, term))!);
    }

    const offset = (filter.page - 1) * filter.pageSize;

    const itemsP = this.db
      .select()
      .from(emailTemplates)
      .where(and(...conds))
      .orderBy(asc(emailTemplates.name), desc(emailTemplates.version))
      .limit(filter.pageSize)
      .offset(offset);

    const totalP = this.db
      .select({ c: count() })
      .from(emailTemplates)
      .where(and(...conds));

    const [items, totalRows] = await Promise.all([itemsP, totalP]);

    if (filter.latestOnly) {
      const seen = new Set<string>();
      const filtered: EmailTemplate[] = [];
      for (const item of items) {
        if (!seen.has(item.name)) {
          seen.add(item.name);
          filtered.push(item);
        }
      }
      return { items: filtered, total: Number(totalRows[0]?.c ?? 0) };
    }

    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  /** Returns the next available `version` for a template name. */
  public async nextTemplateVersion(workspaceId: string, name: string): Promise<number> {
    const latest = await this.findLatestByName(workspaceId, name);
    return (latest?.version ?? 0) + 1;
  }

  /**
   * Returns true if any non-deleted template exists for the given name —
   * used to enforce uniqueness on first-create.
   */
  public async templateNameExists(workspaceId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.workspaceId, workspaceId),
          eq(emailTemplates.name, name),
          isNull(emailTemplates.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}

// silence unused
void ne;
