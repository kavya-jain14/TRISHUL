BEGIN;

INSERT INTO cases (
  id,
  external_case_id,
  state,
  original_transaction_ref,
  graph_version,
  created_at,
  updated_at
) VALUES
  ('00000000-0000-4000-8000-000000000001', 'case:complaint-golden-a', 'REPORTED', 'T1001', 0, '2026-08-24T10:15:00Z', '2026-08-24T10:15:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'case:complaint-golden-b', 'REPORTED', 'T2001', 0, '2026-08-24T11:15:00Z', '2026-08-24T11:15:00Z')
ON CONFLICT (external_case_id) DO NOTHING;

INSERT INTO complaints (
  id,
  external_complaint_id,
  case_id,
  source,
  category,
  reported_amount_minor,
  currency,
  transaction_occurred_at,
  reported_at
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'complaint-golden-a', '00000000-0000-4000-8000-000000000001', 'VICTIM', 'IMPERSONATION', 5000000, 'INR', '2026-08-24T10:00:00Z', '2026-08-24T10:15:00Z'),
  ('10000000-0000-4000-8000-000000000002', 'complaint-golden-b', '00000000-0000-4000-8000-000000000002', 'VICTIM', 'PAYMENT_FRAUD', 1800000, 'INR', '2026-08-24T11:00:00Z', '2026-08-24T11:15:00Z')
ON CONFLICT (external_complaint_id) DO NOTHING;

COMMIT;
