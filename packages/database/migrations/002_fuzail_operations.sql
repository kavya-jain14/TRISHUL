-- Fuzail-owned operational persistence: durable workers, alerts, and cases.
-- Coordinate this shared-schema migration with Kavya, Sandhya, and Vatsal before merge.

ALTER TABLE outbox_jobs
  DROP CONSTRAINT IF EXISTS outbox_jobs_job_type_check;

ALTER TABLE outbox_jobs
  ADD CONSTRAINT outbox_jobs_job_type_check
  CHECK (job_type IN ('TRACE_REFRESH', 'EVIDENCE_ANCHOR', 'ALERT'));

ALTER TABLE outbox_jobs
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0);

CREATE INDEX IF NOT EXISTS outbox_jobs_claim_idx
  ON outbox_jobs (job_type, status, available_at, lease_expires_at);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  dead_letter_id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES outbox_jobs(job_id),
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL,
  replayed_at TIMESTAMPTZ,
  replayed_by TEXT
);

CREATE INDEX IF NOT EXISTS dead_letter_jobs_open_idx
  ON dead_letter_jobs (failed_at) WHERE replayed_at IS NULL;

CREATE TABLE IF NOT EXISTS fraud_cases (
  case_id TEXT PRIMARY KEY,
  current_state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS complaints (
  complaint_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES fraud_cases(case_id),
  transaction_id TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  reported_at TIMESTAMPTZ NOT NULL,
  fraud_context TEXT NOT NULL,
  payer_reference TEXT NOT NULL,
  beneficiary_reference TEXT NOT NULL,
  source_urls JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS case_events (
  event_id UUID PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES fraud_cases(case_id),
  state TEXT NOT NULL,
  rationale TEXT NOT NULL,
  source_urls JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS case_events_timeline_idx
  ON case_events (case_id, occurred_at);

CREATE TABLE IF NOT EXISTS case_graph_versions (
  graph_version_id UUID PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES fraud_cases(case_id),
  graph_version INTEGER NOT NULL CHECK (graph_version > 0),
  graph JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  UNIQUE (case_id, graph_version)
);

CREATE TABLE IF NOT EXISTS case_risk_snapshots (
  risk_snapshot_id UUID PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES fraud_cases(case_id),
  graph_version INTEGER NOT NULL CHECK (graph_version > 0),
  risk JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS case_forecasts (
  forecast_id UUID PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES fraud_cases(case_id),
  graph_version INTEGER NOT NULL CHECK (graph_version > 0),
  forecast JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES fraud_cases(case_id),
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  kind TEXT NOT NULL CHECK (kind IN ('TRACE_RISK', 'EVIDENCE_INTEGRITY', 'INTERVENTION', 'SYSTEM')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_event_id TEXT,
  source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alerts_case_timeline_idx
  ON alerts (case_id, created_at DESC);
