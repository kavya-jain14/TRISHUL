# Phase 2 - exposure and mule/network risk vertical slice

## End-to-end flow

Phase 2 starts from the latest immutable TRACE graph.

1. `POST /api/v1/cases/:caseId/recompute-exposure` accepts provenance-backed known-clean balance evidence for every fraud-reachable account.
2. The exposure reducer propagates a maximum attributable amount through observed financial events without turning commingled funds into an exact rupee claim.
3. `GET /api/v1/cases/:caseId/exposure` returns the exposure snapshot for the current graph version.
4. `POST /api/v1/accounts/:accountId/risk` combines graph-derived movement/network features with provenance-backed provider behaviour signals.
5. `GET /api/v1/cases/:caseId/risk-snapshots` returns versioned, explainable account assessments.

Every write requires an `Idempotency-Key` header. Exposure and risk rows are immutable for a `(case, graph version, account)` tuple. Changed evidence requires a new TRACE graph version rather than rewriting prior intelligence.

## Exposure semantics

Each account state reports:

- observed outgoing value;
- minimum and maximum fraud-linked balance reaching the account under dual-bound propagation;
- known-clean opening balance and non-fraud-compatible observed inflow;
- minimum and maximum attributable outgoing value;
- graph version, method version, input hash, time, and balance-evidence provenance.

Locked commingling example:

| Evidence                         |            Amount |
| -------------------------------- | ----------------: |
| Known-clean balance              |        INR 20,000 |
| Fraud-linked balance             |        INR 50,000 |
| Observed outgoing                |        INR 30,000 |
| Defensible attributable exposure | INR 10,000-30,000 |

The API never reports INR 30,000 as an exact fraud amount merely because INR 30,000 moved.

## Explainable risk features

Graph-derived features:

- fan-in and fan-out;
- pass-through and balance drain;
- rapid forwarding, splitting, and observed cash-out tendency;
- distance from the reported-payment beneficiary and repeated convergence.

Provider-supplied, provenance-backed features:

- inflow spike;
- unique-sender spike;
- first-time-sender ratio;
- behaviour shift;
- cross-case linkage;
- authorised shared-identifier strength.

Complaint count is not a feature. Human intent is not inferred.

## Mule-state boundary

The deterministic rule ladder is `NORMAL -> ANOMALOUS -> WATCH -> SUSPECTED_MULE`. Behaviour, movement, linkage, and network evidence can recommend `SUSPECTED_MULE`; they cannot produce `CONFIRMED`.

`CONFIRMED` requires `trustedOutcome.status = CONFIRMED` and a trusted institutional reference. A trusted clearance maps the account back to `NORMAL`. One rapid transfer alone remains `NORMAL` in the policy unit test.

## Persistence and invalidation

- PostgreSQL persists exposure states and mule assessments with graph/feature/rule versions, canonical calculation hashes, provenance, and trusted-outcome data.
- The in-memory adapter implements the same repository contract for non-durable development.
- A new changed TRACE snapshot moves an `EXPOSURE` or `RISK_ASSESSED` case back to `TRACE`; old snapshots stay available as history and current intelligence must be recomputed.
- Repository/service recreation tests prove case, ledger, graph, exposure, risk, and idempotency survive restart.

## Case Intelligence UI

The golden simulator flow now runs complaint intake, provider ledger ingestion, TRACE, exposure, and account risk through real API endpoints. The UI provides:

- explicit pre-TRACE and pre-exposure states;
- account selection from observed graph nodes;
- observed outgoing and attributable range side by side;
- risk state, score, reason codes, selected derived features, and signal source;
- an explicit non-confirmation message unless a trusted outcome exists.

## Verified acceptance

- The locked INR 20k clean + INR 50k fraud-linked + INR 30k outgoing example returns INR 10k-30k.
- Missing balance evidence and impossible observed balances are rejected.
- Same-version evidence cannot be silently rewritten.
- Risk requires current exposure.
- Complaint-sourced aggregate risk features are rejected.
- Unreferenced confirmation is rejected.
- One rapid transfer does not create a mule verdict.
- Combined behaviour and network evidence can recommend `SUSPECTED_MULE`.
- PostgreSQL restart and real API/simulator/browser orchestration cover the complete slice.

## Next phase

Delivered in [Phase 3](PHASE_3_EXIT_EVIDENCE_GATE.md): versioned exit-mode ranking followed by independent geo/time prediction or abstention decisions with explicit missing-evidence reasons.
