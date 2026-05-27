import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  workflowExecutions,
  workflows,
  type NewWorkflow,
  type Workflow,
  type WorkflowExecution,
  type WorkflowStatus,
} from '@shared/database/schema/workflows.js';
import type { Database } from '@shared/database/client.js';

export interface ListWorkflowsFilter {
  workspaceId: string;
  page: number;
  pageSize: number;
}

export class WorkflowRepository {
  public constructor(private readonly db: Database) {}

  public async insert(values: NewWorkflow): Promise<Workflow> {
    const rows = await this.db.insert(workflows).values(values).returning();
    return rows[0]!;
  }

  public async findById(workspaceId: string, id: string): Promise<Workflow | null> {
    const rows = await this.db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.workspaceId, workspaceId), isNull(workflows.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async list(filter: ListWorkflowsFilter): Promise<{ items: Workflow[]; total: number }> {
    const conds = [eq(workflows.workspaceId, filter.workspaceId), isNull(workflows.deletedAt)];
    const offset = (filter.page - 1) * filter.pageSize;
    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(workflows)
        .where(and(...conds))
        .orderBy(desc(workflows.createdAt))
        .limit(filter.pageSize)
        .offset(offset),
      this.db.select({ c: count() }).from(workflows).where(and(...conds)),
    ]);
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  public async update(
    workspaceId: string,
    id: string,
    patch: Partial<Omit<Workflow, 'id' | 'workspaceId' | 'createdAt'>>,
  ): Promise<Workflow | null> {
    const rows = await this.db
      .update(workflows)
      .set({ ...patch, version: sql`${workflows.version} + 1` })
      .where(and(eq(workflows.id, id), eq(workflows.workspaceId, workspaceId), isNull(workflows.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  public async transitionStatus(
    workspaceId: string,
    id: string,
    fromStatuses: readonly WorkflowStatus[],
    toStatus: WorkflowStatus,
    extra: Partial<Workflow> = {},
  ): Promise<Workflow | null> {
    if (fromStatuses.length === 0) return null;
    const statusCond = fromStatuses.length === 1
      ? eq(workflows.status, fromStatuses[0]!)
      : sql`${workflows.status} IN (${sql.join(fromStatuses.map((s) => sql`${s}`), sql`, `)})`;

    const rows = await this.db
      .update(workflows)
      .set({ status: toStatus, ...extra, version: sql`${workflows.version} + 1` })
      .where(and(eq(workflows.id, id), eq(workflows.workspaceId, workspaceId), isNull(workflows.deletedAt), statusCond))
      .returning();
    return rows[0] ?? null;
  }

  public async softDelete(workspaceId: string, id: string): Promise<Workflow | null> {
    const rows = await this.db
      .update(workflows)
      .set({ deletedAt: new Date(), status: 'archived', version: sql`${workflows.version} + 1` })
      .where(and(eq(workflows.id, id), eq(workflows.workspaceId, workspaceId), isNull(workflows.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  // ─── Executions ───────────────────────────────────────────────────────────

  public async listExecutions(
    workspaceId: string,
    workflowId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: WorkflowExecution[]; total: number }> {
    const conds = [
      eq(workflowExecutions.workspaceId, workspaceId),
      eq(workflowExecutions.workflowId, workflowId),
    ];
    const offset = (page - 1) * pageSize;
    const [items, totalRows] = await Promise.all([
      this.db
        .select()
        .from(workflowExecutions)
        .where(and(...conds))
        .orderBy(desc(workflowExecutions.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ c: count() }).from(workflowExecutions).where(and(...conds)),
    ]);
    return { items, total: Number(totalRows[0]?.c ?? 0) };
  }

  public async getExecutionStats(workspaceId: string, workflowId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    running: number;
  }> {
    const rows = await this.db
      .select({ status: workflowExecutions.status, c: count() })
      .from(workflowExecutions)
      .where(and(eq(workflowExecutions.workspaceId, workspaceId), eq(workflowExecutions.workflowId, workflowId)))
      .groupBy(workflowExecutions.status);

    const stats = { total: 0, completed: 0, failed: 0, running: 0 };
    for (const row of rows) {
      const n = Number(row.c);
      stats.total += n;
      if (row.status === 'completed') stats.completed = n;
      else if (row.status === 'failed') stats.failed = n;
      else if (row.status === 'running') stats.running = n;
    }
    return stats;
  }
}
