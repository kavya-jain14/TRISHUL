BEGIN;

CREATE TABLE cross_case_correlation_runs (
  correlation_run_id text PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  graph_version integer NOT NULL CHECK (graph_version > 0),
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  snapshot jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (case_id, idempotency_key)
);

CREATE INDEX cross_case_correlation_latest_idx
  ON cross_case_correlation_runs (case_id, evaluated_at DESC, correlation_run_id DESC);

ALTER TABLE mule_assessments
  ADD COLUMN cross_case_correlation_run_id text
  REFERENCES cross_case_correlation_runs(correlation_run_id);

COMMIT;
