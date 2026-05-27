-- Migration: 0001_contacts_segments
-- Adds contacts, contact_tags, and replaces the segments stub with the full schema.

-- ─── Drop old segments stub (campaigns FK will be re-added) ─────────────────
-- NOTE: campaigns.segment_id references segments.id — we must drop that FK first.
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_segment_id_fkey;
DROP TABLE IF EXISTS segments CASCADE;

-- ─── contacts ────────────────────────────────────────────────────────────────
CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email           VARCHAR(254),
  anonymous_id    VARCHAR(255),
  external_id     VARCHAR(255),
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  phone           VARCHAR(30),
  lifecycle_stage VARCHAR(32) DEFAULT 'lead',
  lead_score      INTEGER NOT NULL DEFAULT 0,
  properties      JSONB NOT NULL DEFAULT '{}'::jsonb,
  source          JSONB NOT NULL DEFAULT '{}'::jsonb,
  email_suppressed    BOOLEAN NOT NULL DEFAULT FALSE,
  globally_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  unsubscribed        BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contacts_workspace_email_uniq UNIQUE (workspace_id, email)
);

CREATE INDEX contacts_workspace_idx       ON contacts (workspace_id);
CREATE INDEX contacts_email_idx           ON contacts (email);
CREATE INDEX contacts_anonymous_id_idx    ON contacts (anonymous_id);
CREATE INDEX contacts_external_id_idx     ON contacts (external_id);
CREATE INDEX contacts_lifecycle_stage_idx ON contacts (lifecycle_stage);
CREATE INDEX contacts_created_at_idx      ON contacts (created_at);
CREATE INDEX contacts_properties_gin_idx  ON contacts USING gin (properties);

-- ─── contact_tags ─────────────────────────────────────────────────────────────
CREATE TABLE contact_tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag          VARCHAR(100) NOT NULL,
  CONSTRAINT contact_tags_contact_tag_uniq UNIQUE (contact_id, tag)
);

CREATE INDEX contact_tags_workspace_idx ON contact_tags (workspace_id);
CREATE INDEX contact_tags_contact_idx   ON contact_tags (contact_id);
CREATE INDEX contact_tags_tag_idx       ON contact_tags (tag);

-- ─── segments (full replacement) ─────────────────────────────────────────────
CREATE TABLE segments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  type          VARCHAR(16) NOT NULL DEFAULT 'static',
  filter_tree   JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_count INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  last_computed TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT segments_workspace_name_uniq UNIQUE (workspace_id, name)
);

CREATE INDEX segments_workspace_idx ON segments (workspace_id);
CREATE INDEX segments_status_idx    ON segments (status);
CREATE INDEX segments_type_idx      ON segments (type);

-- ─── segment_memberships ─────────────────────────────────────────────────────
CREATE TABLE segment_memberships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  segment_id   UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT segment_memberships_segment_contact_uniq UNIQUE (segment_id, contact_id)
);

CREATE INDEX segment_memberships_workspace_idx ON segment_memberships (workspace_id);
CREATE INDEX segment_memberships_segment_idx   ON segment_memberships (segment_id);
CREATE INDEX segment_memberships_contact_idx   ON segment_memberships (contact_id);

-- ─── Restore campaigns FK to new segments table ──────────────────────────────
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_segment_id_fkey
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE SET NULL;
