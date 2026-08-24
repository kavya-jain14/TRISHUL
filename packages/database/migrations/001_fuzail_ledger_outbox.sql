-- Fuzail-owned persistence: payment events, trace-refresh jobs, and audit anchors.
-- Apply through the deployment migration runner, not from the browser.

CREATE TABLE IF NOT EXISTS payment_transactions (
  transaction_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('SYNTHETIC_LEDGER', 'AUTHORISED_PARTNER'))
);

CREATE TABLE IF NOT EXISTS transaction_events (
  event_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES payment_transactions(transaction_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  channel TEXT NOT NULL,
  location_id TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  intelligence JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL CHECK (source IN ('SYNTHETIC_LEDGER', 'AUTHORISED_PARTNER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_events_trace_idx
  ON transaction_events (from_account_id, occurred_at);
CREATE INDEX IF NOT EXISTS transaction_events_transaction_idx
  ON transaction_events (transaction_id, occurred_at, sequence);

CREATE TABLE IF NOT EXISTS outbox_jobs (
  job_id UUID PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('TRACE_REFRESH', 'EVIDENCE_ANCHOR')),
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  available_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_jobs_ready_idx
  ON outbox_jobs (job_type, status, available_at);

CREATE TABLE IF NOT EXISTS outbox_attempts (
  attempt_id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES outbox_jobs(job_id),
  attempted_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('FAILED', 'SUCCEEDED')),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS evidence_hash_anchors (
  anchor_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  previous_anchor_hash TEXT,
  anchor_hash TEXT NOT NULL UNIQUE,
  anchored_at TIMESTAMPTZ NOT NULL
);

