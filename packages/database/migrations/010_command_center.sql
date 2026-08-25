BEGIN;

CREATE TABLE case_priority_snapshots (
  priority_run_id text PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  graph_version integer NOT NULL CHECK (graph_version >= 0),
  priority_score integer NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  priority_band text NOT NULL CHECK (priority_band IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  operational_state text NOT NULL CHECK (operational_state IN (
    'ACTIVE_INTERVENTION_WINDOW', 'ELEVATED_HORIZON', 'MONITORING',
    'CASH_OUT_MAY_HAVE_OCCURRED', 'OUTCOME_KNOWN'
  )),
  snapshot jsonb NOT NULL,
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  calculated_at timestamptz NOT NULL,
  UNIQUE (case_id, idempotency_key)
);

CREATE INDEX case_priority_latest_idx
  ON case_priority_snapshots (case_id, calculated_at DESC, priority_run_id DESC);

ALTER TABLE alerts
  ADD COLUMN priority_run_id text REFERENCES case_priority_snapshots(priority_run_id),
  ADD COLUMN deduplication_key text,
  ADD COLUMN reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  ADD COLUMN acknowledged_by text,
  ADD COLUMN acknowledgement_rationale text,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by text,
  ADD COLUMN resolution_rationale text;

UPDATE alerts SET status = 'ACKNOWLEDGED' WHERE acknowledged_at IS NOT NULL;

CREATE UNIQUE INDEX alerts_deduplication_idx
  ON alerts (deduplication_key) WHERE deduplication_key IS NOT NULL;
CREATE INDEX alerts_open_case_idx
  ON alerts (case_id, created_at DESC) WHERE status = 'OPEN';

CREATE TABLE alert_lifecycle_idempotency (
  operation text NOT NULL CHECK (operation IN ('ACKNOWLEDGE', 'RESOLVE')),
  alert_id text NOT NULL REFERENCES alerts(alert_id),
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (operation, alert_id, idempotency_key)
);

COMMIT;
