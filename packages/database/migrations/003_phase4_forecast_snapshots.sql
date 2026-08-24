-- Extend the foundation prediction_runs table into the canonical immutable
-- Phase 4 snapshot store. Existing pre-Phase-4 rows remain readable as legacy
-- runs because the new lineage columns are nullable at the database boundary.

ALTER TABLE prediction_runs
  ADD COLUMN prediction_ref text UNIQUE;

ALTER TABLE prediction_runs
  ADD COLUMN previous_prediction_ref text REFERENCES prediction_runs(prediction_ref);

ALTER TABLE prediction_runs
  ADD COLUMN evidence_gate_ref text REFERENCES evidence_gate_snapshots(evidence_gate_ref);

ALTER TABLE prediction_runs
  ADD COLUMN account_id uuid REFERENCES accounts(id);

ALTER TABLE prediction_runs
  ADD COLUMN evidence_gate_decision text CHECK (
    evidence_gate_decision IN ('PREDICT', 'PARTIAL', 'ABSTAIN')
  );

ALTER TABLE prediction_runs
  ADD COLUMN calculation_input_hash char(64);

ALTER TABLE prediction_runs
  ADD COLUMN confidence numeric(5,4) CHECK (confidence >= 0 AND confidence <= 1);

CREATE UNIQUE INDEX prediction_runs_canonical_case_graph_idx
  ON prediction_runs (case_id, graph_version)
  WHERE prediction_ref IS NOT NULL;

CREATE INDEX prediction_runs_prediction_ref_idx
  ON prediction_runs (prediction_ref)
  WHERE prediction_ref IS NOT NULL;
