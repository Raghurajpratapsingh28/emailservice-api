import { Counter } from 'prom-client';

export const workflowsCreated = new Counter({
  name: 'workflows_created_total',
  help: 'Total workflows created',
  labelNames: ['workspace_id'] as const,
});

export const workflowsPublished = new Counter({
  name: 'workflows_published_total',
  help: 'Total workflows published',
  labelNames: ['workspace_id'] as const,
});

export const workflowValidationFailures = new Counter({
  name: 'workflow_validation_failures_total',
  help: 'Total workflow graph validation failures',
  labelNames: ['workspace_id'] as const,
});
