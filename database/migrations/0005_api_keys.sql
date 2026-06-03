-- Migration: 0005_api_keys
-- Creates the api_keys table for SDK / server-side authentication.

CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  key_hash        VARCHAR(128) NOT NULL,
  key_prefix      VARCHAR(16)  NOT NULL,
  scope           VARCHAR(256) NOT NULL DEFAULT 'events.write',
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  rate_limit      INTEGER      NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_uniq  ON api_keys (key_hash);
CREATE        INDEX IF NOT EXISTS api_keys_workspace_idx  ON api_keys (workspace_id);
CREATE        INDEX IF NOT EXISTS api_keys_active_idx     ON api_keys (workspace_id, is_active);
