BEGIN;

CREATE TABLE payment_risk_assessments (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  assessment_id text NOT NULL UNIQUE,
  payment_reference text NOT NULL,
  assessment jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX payment_risk_latest_idx
  ON payment_risk_assessments (payment_reference, evaluated_at DESC, assessment_id DESC);

COMMIT;
