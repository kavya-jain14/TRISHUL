# Phase 0 - foundation checkpoint (complete)

## Included in this checkpoint

- npm/TypeScript monorepo with four runtime apps and seven domain packages
- CI, formatting, strict type-checking, tests, and production builds
- Shared runtime schemas for cases, complaints, provider events, graph provenance, risk, and forecasts
- Validated investigation state transitions
- Integer-minor-unit exposure range calculation
- Explainable mule/network assessment that cannot confirm guilt without trusted outcome
- Deterministic Evidence Gate with explicit abstention reasons
- Canonical evidence hashing and mutation detection primitive
- PostgreSQL core schema with versioned graph/risk/exposure/forecast history
- Deterministic full-pipeline and stationary/abstention provider scenarios
- API and frontend foundations

## Not yet claimed

- No production bank/NPCI/I4C integration
- No trained production ML model or production accuracy metric
- No real zero-knowledge circuit
- No deployed blockchain network
- No autonomous account freeze or guaranteed recovery

## Handoff to Phase 1

`POST /complaints` -> transaction resolver -> provider events -> provenance-backed graph -> `GET /cases/:id/graph` is implemented in Phase 1.

The Phase 1 acceptance inherited from this checkpoint was:

1. Complaint creation and resolution are idempotent.
2. Replaying a provider event cannot duplicate an edge.
3. An edge without provenance is rejected.
4. Missing provider visibility produces an explicit graph boundary.
5. The Case Intelligence screen renders only backend-returned nodes and edges.
