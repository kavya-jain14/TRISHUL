BEGIN;

CREATE TABLE evidence_anchor_receipts (
  anchor_id text PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  evidence_ref text NOT NULL,
  evidence_hash char(64) NOT NULL,
  submission_hash char(64) NOT NULL UNIQUE,
  provider text NOT NULL,
  network text NOT NULL,
  anchor_reference text NOT NULL UNIQUE,
  transaction_hash char(64) NOT NULL UNIQUE,
  anchored_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, idempotency_key),
  UNIQUE (case_id, evidence_ref, evidence_hash)
);

CREATE INDEX evidence_anchor_case_time_idx
  ON evidence_anchor_receipts (case_id, anchored_at DESC);

COMMIT;
