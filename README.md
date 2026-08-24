# TRISHUL

**Continuous case-to-cash-out intelligence for authorised financial cyber-fraud response.**

TRISHUL turns a reported transaction into an evolving, provenance-backed financial-intelligence graph. It tracks fraud-attributable exposure, explains behavioural and network risk, and forecasts probable cash-out zones and time horizons only when the available evidence supports a prediction.

> Verify what can be verified. Observe what can be observed. Trace what can be traced. Predict only what the evidence supports. Abstain when it does not.

## Product boundary

- PrivacyPass proves trust properties and scoped access; it does not prove innocence.
- TRINETRA evaluates observable payer, receiver, transaction, and network signals; it does not infer human intent.
- Complaints create cases and labelled graph memory; they are not a dominant account blacklist signal.
- Authorised bank/PSP/FI records create money-flow edges; blockchain does not trace UPI transfers.
- Exposure is represented as a defensible range after funds commingle.
- Location and time forecasts can independently `PREDICT` or `ABSTAIN`.
- TRISHUL supports authorised bank/LEA decisions; it does not autonomously freeze national payment traffic.

## Repository

```text
apps/
  api/            Main HTTP API
  psp-sandbox/    Deterministic bank/PSP event simulator
  web/            Investigation workspace
  worker/         Trace, reforecast, and alert job entrypoint
packages/
  audit/          Evidence hashing and anchor abstraction
  contracts/      Shared runtime schemas and state machine
  database/       PostgreSQL schema and migration metadata
  graph/          Provenance and exposure utilities
  intelligence/   Behaviour and mule/network risk logic
  prediction/     Exit/evidence-gate interfaces and rules
  trust/          Credential, revocation, and access abstractions
docs/             Architecture, product lock, workflow, and phase status
```

## Quick start

Requirements: Node.js 22+ and npm 10+. Docker is optional for PostgreSQL and Redis.

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis
npm run db:migrate
npm run dev:api
```

In separate terminals:

```bash
npm run dev:psp
npm run dev:web
```

For the deterministic three-service presentation setup:

```bash
npm run demo:smoke
npm run dev:demo
```

See [docs/PRESENTATION_RUNBOOK.md](docs/PRESENTATION_RUNBOOK.md) for the exact judge flow and offline
recovery steps.

Run the verification suite:

```bash
npm run check
```

To run only the non-durable development adapter, start the API without `DATABASE_URL`.

Infrastructure status:

```bash
docker compose up -d postgres redis
```

## Delivery order

1. Foundation and shared contracts
2. Complaint-to-trace vertical slice
3. Exposure and mule/network risk
4. Exit mode and Evidence Gate
5. Zone/time forecasting and continuous reforecasting
6. PrivacyPass and lawful identity resolution
7. Evidence anchors, command centre, and final QA

See [docs/EVIDENCE_ANCHOR_BACKEND.md](docs/EVIDENCE_ANCHOR_BACKEND.md) for the accelerated backend integrity checkpoint, [docs/PHASE_3_EXIT_EVIDENCE_GATE.md](docs/PHASE_3_EXIT_EVIDENCE_GATE.md) for the current prediction checkpoint, and [docs/PHASE_1_TRACE.md](docs/PHASE_1_TRACE.md) for the trace foundation.

## Collaboration

No direct feature work on `main`. Pull latest, create the assigned feature branch, run `npm run check`, then open a PR. Shared contracts must land before UI code depends on them. Full rules and ownership are in [docs/TEAM_WORKFLOW.md](docs/TEAM_WORKFLOW.md).
