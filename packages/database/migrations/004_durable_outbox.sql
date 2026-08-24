BEGIN;

CREATE TABLE outbox_jobs (
  job_id uuid PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN (
    'TRACE_GRAPH_EXPANSION', 'EXPOSURE_RECOMPUTE', 'RISK_REASSESSMENT',
    'FORECAST_REFRESH', 'ALERT_DISPATCH', 'EVIDENCE_ANCHOR'
  )),
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  locked_by text,
  lock_token uuid,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  last_error text,
  CHECK (
    (status = 'PROCESSING' AND locked_by IS NOT NULL AND lock_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status <> 'PROCESSING'
  )
);

CREATE INDEX outbox_jobs_claim_idx
  ON outbox_jobs (job_type, status, available_at, lease_expires_at);

CREATE TABLE outbox_attempts (
  attempt_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES outbox_jobs(job_id),
  lock_token uuid NOT NULL,
  attempted_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('FAILED', 'SUCCEEDED')),
  error_message text
);

CREATE TABLE dead_letter_jobs (
  dead_letter_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES outbox_jobs(job_id),
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  failure_reason text NOT NULL,
  failed_at timestamptz NOT NULL,
  replayed_at timestamptz,
  replayed_by text
);

CREATE INDEX dead_letter_jobs_open_idx
  ON dead_letter_jobs (failed_at DESC) WHERE replayed_at IS NULL;

CREATE TABLE alerts (
  alert_id text PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  kind text NOT NULL CHECK (kind IN ('TRACE_RISK', 'EVIDENCE_INTEGRITY', 'INTERVENTION', 'SYSTEM')),
  title text NOT NULL,
  message text NOT NULL,
  source_event_id text,
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  acknowledged_at timestamptz
);

CREATE INDEX alerts_case_timeline_idx ON alerts (case_id, created_at DESC);

COMMIT;
