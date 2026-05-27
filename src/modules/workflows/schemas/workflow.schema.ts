import { z } from 'zod';

export const workflowIdParamSchema = z.object({ id: z.string().uuid() });

const nodeConfigSchema = z.record(z.string(), z.unknown());

const workflowNodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['trigger', 'email', 'delay', 'end']),
  config: nodeConfigSchema.optional(),
});

const workflowEdgeSchema = z.object({
  from: z.string().min(1).max(100),
  to: z.string().min(1).max(100),
});

const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema).min(1).max(100),
  edges: z.array(workflowEdgeSchema).max(200),
});

export const createWorkflowBodySchema = z.object({
  name: z.string().min(1).max(200),
  graph: workflowGraphSchema,
});

export const updateWorkflowBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  graph: workflowGraphSchema.optional(),
});

export const listWorkflowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listExecutionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateWorkflowBody = z.infer<typeof createWorkflowBodySchema>;
export type UpdateWorkflowBody = z.infer<typeof updateWorkflowBodySchema>;
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;
