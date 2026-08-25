BEGIN;

ALTER TABLE trust_sessions
  ADD COLUMN case_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
