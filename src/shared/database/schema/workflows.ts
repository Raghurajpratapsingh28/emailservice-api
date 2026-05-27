import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { workspaces } from './workspaces.js';
import { contacts } from './contacts.js';

export const WORKFLOW_STATUSES = ['draft', 'published', 'paused', 'archived'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_TRIGGER_TYPES = ['event', 'segment_enter', 'manual'] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

export const WORKFLOW_NODE_TYPES = ['trigger', 'email', 'delay', 'end'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const workflows = pgTable(
  'workflows',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar({ length: 200 }).notNull(),
    status: varchar({ length: 16 }).notNull().default('draft'),
    triggerType: varchar({ length: 32 }),
    triggerConfig: jsonb().notNull().default(sql`'{}'::jsonb`),
    graph: jsonb().notNull().default(sql`'{}'::jsonb`),
    version: integer().notNull().default(1),
    publishedAt: timestamp({ withTimezone: true }),
    pausedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    index('workflows_workspace_idx').on(t.workspaceId),
    index('workflows_status_idx').on(t.status),
    index('workflows_trigger_type_idx').on(t.triggerType),
  ],
);

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export const EXECUTION_STATUSES = ['queued', 'running', 'waiting', 'completed', 'failed'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const workflowExecutions = pgTable(
  'workflow_executions',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workflowId: uuid()
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    currentNodeId: varchar({ length: 100 }),
    status: varchar({ length: 16 }).notNull().default('queued'),
    executionContext: jsonb().notNull().default(sql`'{}'::jsonb`),
    nextRunAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    failedAt: timestamp({ withTimezone: true }),
    failureReason: text(),
    retryCount: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [
    index('workflow_executions_workspace_idx').on(t.workspaceId),
    index('workflow_executions_workflow_idx').on(t.workflowId),
    index('workflow_executions_contact_idx').on(t.contactId),
    index('workflow_executions_status_idx').on(t.status),
    index('workflow_executions_next_run_idx').on(t.nextRunAt),
  ],
);

export type WorkflowExecution = typeof workflowExecutions.$inferSelect;
export type NewWorkflowExecution = typeof workflowExecutions.$inferInsert;

// Graph types
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
