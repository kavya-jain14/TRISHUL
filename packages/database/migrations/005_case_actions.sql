BEGIN;

ALTER TABLE outbox_jobs DROP CONSTRAINT IF EXISTS outbox_jobs_job_type_check;
ALTER TABLE outbox_jobs ADD CONSTRAINT outbox_jobs_job_type_check CHECK (job_type IN (
  'TRACE_GRAPH_EXPANSION', 'EXPOSURE_RECOMPUTE', 'RISK_REASSESSMENT',
  'FORECAST_REFRESH', 'ALERT_DISPATCH', 'EVIDENCE_ANCHOR', 'CASE_ACTION_EVENT'
));

CREATE TABLE case_actions (
  action_id text PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  action_type text NOT NULL CHECK (action_type IN (
    'ALERT_BANK', 'ALERT_LEA', 'ESCALATE_CASE', 'ADD_ANALYST_NOTE', 'ADD_OUTCOME_NOTE'
  )),
  actor_ref text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN (
    'INVESTIGATOR', 'SUPERVISOR', 'AUDITOR', 'LEA_OFFICER'
  )),
  purpose text NOT NULL,
  rationale text NOT NULL,
  evidence_anchor_ids jsonb NOT NULL,
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  UNIQUE (case_id, idempotency_key)
);

CREATE INDEX case_actions_case_timeline_idx ON case_actions (case_id, occurred_at DESC, action_id);

COMMIT;
