# TRINETRA payment-risk gateway

## Boundary

`POST /api/v1/risk/evaluate` evaluates observable payer, receiver, transaction, and network signals before a payment. It never infers payer intent, declares fraud, or autonomously blocks national payment traffic.

The endpoint is an internal bank/PSP/FI boundary. Production requires `TRISHUL_INTERNAL_SERVICE_TOKEN`; development may use labelled simulator provenance. Unknown fields and complaint-sourced behavioural signals are rejected.

## Decision model

- `ALLOW`: no material multi-signal risk, or a payer-only anomaly was cleared by provider-verified step-up.
- `WARN`: explainable caution below the step-up threshold.
- `STEP_UP`: payer anomaly, invalid/revoked receiver trust, or material receiver/network evidence requires partner review.
- `PARTNER_BLOCK`: reserved in the shared contract for an integrated partner policy. The TRISHUL rule engine does not emit it autonomously.

Trust is reported separately and never subtracts behavioural/network risk. A receiver can be credential-verified and still require step-up because verification is a trust property, not proof of safety.

## Persistence and replay

Every write requires `Idempotency-Key`. PostgreSQL stores the validated assessment, input hash, rule/feature version, provenance, and decision. Reusing a key with changed content returns `409 PAYMENT_RISK_IDEMPOTENCY_CONFLICT`. Assessments are append-only across distinct keys and the latest assessment is available at `GET /api/v1/risk/evaluations/:paymentReference/latest`.

## Golden demo

1. A high-value payment to a new beneficiary produces `STEP_UP` without labelling the payment fraudulent.
2. The bank/PSP supplies a verified step-up reference.
3. If receiver behaviour and network evidence remain low, the same payment context can produce `ALLOW`.
4. A verified receiver with strong pass-through and network-linkage evidence still produces `STEP_UP`; trust never overrides risk.
