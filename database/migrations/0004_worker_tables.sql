-- Migration: 0004_worker_tables
-- Adds tables and columns required by engageiq-workers.

-- ─── contacts: add columns used by workers ───────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS user_id VARCHAR(512);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_suppressed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_email_valid BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS traits JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_user_id_uniq ON contacts (workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_anonymous_id_uniq ON contacts (workspace_id, anonymous_id);

-- ─── campaigns: add columns used by workers ──────────────────────────────────
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_recipients INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- ─── campaign_recipients: add columns used by workers ────────────────────────
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS name VARCHAR(200);
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_campaign_contact_uniq ON campaign_recipients (campaign_id, contact_id);

-- ─── events_raw: add columns used by workers ─────────────────────────────────
ALTER TABLE events_raw ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events_raw ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE events_raw ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE events_raw ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ─── events_enriched ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events_enriched (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  raw_event_id    UUID NOT NULL UNIQUE REFERENCES events_raw(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  user_id         VARCHAR(512),
  anonymous_id    VARCHAR(512),
  event_type      VARCHAR(16) NOT NULL,
  event_name      VARCHAR(512),
  properties      JSONB NOT NULL DEFAULT '{}'::jsonb,
  traits          JSONB NOT NULL DEFAULT '{}'::jsonb,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  enriched_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_enriched_workspace_idx ON events_enriched (workspace_id);
CREATE INDEX IF NOT EXISTS events_enriched_contact_idx ON events_enriched (contact_id);
CREATE INDEX IF NOT EXISTS events_enriched_event_name_idx ON events_enriched (event_name);
CREATE INDEX IF NOT EXISTS events_enriched_workspace_contact_event_idx ON events_enriched (workspace_id, contact_id, event_name);

-- ─── workflow_triggers ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_triggers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  event_type      VARCHAR(32),
  event_name      VARCHAR(512),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workflow_triggers_workspace_idx ON workflow_triggers (workspace_id);
CREATE INDEX IF NOT EXISTS workflow_triggers_workflow_idx ON workflow_triggers (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_triggers_lookup_idx ON workflow_triggers (workspace_id, event_type, event_name, active);

-- ─── workflow_executions: add columns used by workers ────────────────────────
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS trigger_event_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_executions_workflow_contact_trigger_uniq
  ON workflow_executions (workflow_id, contact_id, trigger_event_id);

-- ─── workflows: add nodes column used by workers ─────────────────────────────
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS nodes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── segments: add last_computed if missing ──────────────────────────────────
-- (already exists from 0001, but ensure updated_at exists)
ALTER TABLE segments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
