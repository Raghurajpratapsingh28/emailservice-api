-- Migration: 0003_billing
-- Adds subscriptions, billing_events, usage_counters, invoices tables.

-- ─── subscriptions ───────────────────────────────────────────────────────────
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id       VARCHAR(64),
  stripe_subscription_id   VARCHAR(64),
  stripe_price_id          VARCHAR(64),
  stripe_product_id        VARCHAR(64),
  plan                     VARCHAR(32) NOT NULL DEFAULT 'free',
  billing_interval         VARCHAR(16),
  status                   VARCHAR(32) NOT NULL DEFAULT 'active',
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  trial_ends_at            TIMESTAMPTZ,
  canceled_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_workspace_uniq UNIQUE (workspace_id)
);

CREATE INDEX subscriptions_stripe_customer_idx     ON subscriptions (stripe_customer_id);
CREATE INDEX subscriptions_stripe_subscription_idx ON subscriptions (stripe_subscription_id);
CREATE INDEX subscriptions_status_idx              ON subscriptions (status);

-- ─── billing_events ──────────────────────────────────────────────────────────
CREATE TABLE billing_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  stripe_event_id     VARCHAR(64) NOT NULL,
  stripe_event_type   VARCHAR(100) NOT NULL,
  payload             JSONB NOT NULL,
  processed           BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_events_stripe_event_uniq UNIQUE (stripe_event_id)
);

CREATE INDEX billing_events_workspace_idx ON billing_events (workspace_id);
CREATE INDEX billing_events_type_idx      ON billing_events (stripe_event_type);

-- ─── usage_counters ──────────────────────────────────────────────────────────
CREATE TABLE usage_counters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric          VARCHAR(32) NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  usage_count     BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT usage_counters_workspace_metric_period_uniq
    UNIQUE (workspace_id, metric, period_start)
);

CREATE INDEX usage_counters_workspace_idx ON usage_counters (workspace_id);

-- ─── invoices ────────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_invoice_id    VARCHAR(64) NOT NULL,
  stripe_customer_id   VARCHAR(64),
  amount_due           BIGINT NOT NULL DEFAULT 0,
  amount_paid          BIGINT NOT NULL DEFAULT 0,
  currency             VARCHAR(8) NOT NULL DEFAULT 'usd',
  status               VARCHAR(32) NOT NULL DEFAULT 'draft',
  hosted_invoice_url   TEXT,
  invoice_pdf          TEXT,
  invoice_date         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_stripe_invoice_uniq UNIQUE (stripe_invoice_id)
);

CREATE INDEX invoices_workspace_idx ON invoices (workspace_id);
CREATE INDEX invoices_status_idx    ON invoices (status);
