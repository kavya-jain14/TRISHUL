BEGIN;

CREATE TABLE cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_case_id text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN (
    'REPORTED', 'ACTIVE', 'TRACE', 'EXPOSURE', 'RISK_ASSESSED', 'EXIT_MODE',
    'EVIDENCE_GATE', 'PREDICT', 'ABSTAIN', 'INTERVENTION', 'MONITORING',
    'OUTCOME', 'CLOSED'
  )),
  original_transaction_ref text NOT NULL,
  graph_version integer NOT NULL DEFAULT 0 CHECK (graph_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_complaint_id text NOT NULL UNIQUE,
  case_id uuid NOT NULL REFERENCES cases(id),
  source text NOT NULL,
  category text NOT NULL,
  reported_amount_minor bigint NOT NULL CHECK (reported_amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  payer_reference text,
  beneficiary_reference text,
  transaction_occurred_at timestamptz NOT NULL,
  reported_at timestamptz NOT NULL,
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_ref text NOT NULL,
  provider_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_name, provider_account_ref)
);

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases(id),
  transaction_ref text NOT NULL,
  provider_ref text NOT NULL,
  from_account_id uuid REFERENCES accounts(id),
  to_account_id uuid REFERENCES accounts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  occurred_at timestamptz NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_ref, transaction_ref)
);

CREATE TABLE transaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  case_id uuid REFERENCES cases(id),
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  event_hash char(64) NOT NULL,
  payload jsonb NOT NULL,
  provenance jsonb NOT NULL,
  processed_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE graph_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  version integer NOT NULL CHECK (version > 0),
  source_event_id text NOT NULL,
  coverage_boundary text,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

CREATE TABLE graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  node_ref text NOT NULL,
  node_type text NOT NULL,
  label text NOT NULL,
  first_graph_version integer NOT NULL CHECK (first_graph_version > 0),
  first_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, node_ref)
);

CREATE TABLE graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  graph_version integer NOT NULL CHECK (graph_version > 0),
  edge_ref text NOT NULL,
  from_node_id uuid NOT NULL REFERENCES graph_nodes(id),
  to_node_id uuid NOT NULL REFERENCES graph_nodes(id),
  edge_type text NOT NULL,
  transaction_id uuid REFERENCES payment_transactions(id),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency char(3),
  occurred_at timestamptz NOT NULL,
  provenance jsonb NOT NULL CHECK (provenance <> '{}'::jsonb),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, edge_ref)
);

CREATE TABLE exposure_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exposure_state_ref text NOT NULL UNIQUE,
  snapshot_ref text NOT NULL,
  case_id uuid NOT NULL REFERENCES cases(id),
  graph_version integer NOT NULL CHECK (graph_version > 0),
  account_id uuid NOT NULL REFERENCES accounts(id),
  observed_outgoing_minor bigint NOT NULL CHECK (observed_outgoing_minor >= 0),
  minimum_fraud_linked_balance_minor bigint NOT NULL CHECK (minimum_fraud_linked_balance_minor >= 0),
  fraud_linked_balance_minor bigint NOT NULL CHECK (fraud_linked_balance_minor >= 0),
  known_clean_balance_minor bigint NOT NULL CHECK (known_clean_balance_minor >= 0),
  non_fraud_compatible_inflow_minor bigint NOT NULL CHECK (non_fraud_compatible_inflow_minor >= 0),
  minimum_attributable_minor bigint NOT NULL CHECK (minimum_attributable_minor >= 0),
  maximum_attributable_minor bigint NOT NULL CHECK (maximum_attributable_minor >= minimum_attributable_minor),
  currency char(3) NOT NULL DEFAULT 'INR',
  method_version text NOT NULL,
  calculation_input_hash char(64) NOT NULL,
  balance_provenance jsonb NOT NULL CHECK (balance_provenance <> '{}'::jsonb),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_fraud_linked_balance_minor <= fraud_linked_balance_minor),
  CHECK (maximum_attributable_minor <= observed_outgoing_minor),
  UNIQUE (case_id, graph_version, account_id)
);

CREATE TABLE mule_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_ref text NOT NULL UNIQUE,
  case_id uuid NOT NULL REFERENCES cases(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  graph_version integer NOT NULL CHECK (graph_version > 0),
  state text NOT NULL CHECK (state IN ('NORMAL', 'ANOMALOUS', 'WATCH', 'SUSPECTED_MULE', 'CONFIRMED')),
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  reason_codes jsonb NOT NULL,
  features jsonb NOT NULL,
  feature_version text NOT NULL,
  rule_version text NOT NULL,
  calculation_input_hash char(64) NOT NULL,
  signal_provenance jsonb NOT NULL CHECK (signal_provenance <> '{}'::jsonb),
  trusted_outcome jsonb NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, graph_version, account_id)
);

CREATE TABLE prediction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  graph_version integer NOT NULL CHECK (graph_version > 0),
  feature_version text NOT NULL,
  model_version text NOT NULL,
  rule_version text NOT NULL,
  evidence_coverage numeric(5,4) NOT NULL CHECK (evidence_coverage >= 0 AND evidence_coverage <= 1),
  gate_outcome text NOT NULL CHECK (gate_outcome IN ('PASS', 'ABSTAIN')),
  exit_mode text NOT NULL,
  geo_output jsonb NOT NULL,
  time_output jsonb NOT NULL,
  reason_codes jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id),
  evidence_ref text NOT NULL,
  storage_ref text NOT NULL,
  sha256 char(64) NOT NULL,
  source_metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, evidence_ref)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases(id),
  actor_ref text NOT NULL,
  action text NOT NULL,
  purpose text,
  event_hash char(64) NOT NULL,
  anchor_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  key text NOT NULL,
  operation text NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (operation, key)
);

CREATE INDEX graph_edges_case_version_idx ON graph_edges (case_id, graph_version);
CREATE INDEX transaction_events_case_time_idx ON transaction_events (case_id, occurred_at);
CREATE INDEX mule_assessments_case_time_idx ON mule_assessments (case_id, assessed_at DESC);
CREATE INDEX prediction_runs_case_time_idx ON prediction_runs (case_id, generated_at DESC);
CREATE INDEX audit_events_case_time_idx ON audit_events (case_id, created_at);

COMMIT;
