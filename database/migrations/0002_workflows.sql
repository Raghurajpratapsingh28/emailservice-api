-- Migration: 0002_workflows
-- Adds workflows and workflow_executions tables.

CREATE TABLE workflows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'draft',
  trigger_type    VARCHAR(32),
  trigger_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  graph           JSONB NOT NULL DEFAULT '{}'::jsonb,
  version         INTEGER NOT NULL DEFAULT 1,
  published_at    TIMESTAMPTZ,
  paused_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX workflows_workspace_idx     ON workflows (workspace_id);
CREATE INDEX workflows_status_idx        ON workflows (status);
CREATE INDEX workflows_trigger_type_idx  ON workflows (trigger_type);

CREATE TABLE workflow_executions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id         UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  current_node_id     VARCHAR(100),
  status              VARCHAR(16) NOT NULL DEFAULT 'queued',
  execution_context   JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_run_at         TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_reason      TEXT,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX workflow_executions_workspace_idx ON workflow_executions (workspace_id);
CREATE INDEX workflow_executions_workflow_idx  ON workflow_executions (workflow_id);
CREATE INDEX workflow_executions_contact_idx   ON workflow_executions (contact_id);
CREATE INDEX workflow_executions_status_idx    ON workflow_executions (status);
CREATE INDEX workflow_executions_next_run_idx  ON workflow_executions (next_run_at);
