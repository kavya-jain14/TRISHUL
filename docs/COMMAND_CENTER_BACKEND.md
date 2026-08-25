# Command Center backend

This checkpoint implements the blueprint's operational Command Center without turning a complaint, risk score, or forecast into a guilt judgement.

## What is implemented

- deterministic case priority from attributable exposure, Mule Risk, cross-case linkage, exit mode, Evidence Gate, and forecast horizon
- five explicit operational states:
  - `ACTIVE_INTERVENTION_WINDOW`
  - `ELEVATED_HORIZON`
  - `MONITORING`
  - `CASH_OUT_MAY_HAVE_OCCURRED`
  - `OUTCOME_KNOWN`
- `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL` operational priority bands
- explainable reason codes and recommended actions
- immediate durable alert creation plus an idempotent `ALERT_DISPATCH` outbox job
- `OPEN` -> `ACKNOWLEDGED` -> `RESOLVED` alert lifecycle
- supervisor-only resolution; investigator acknowledgement
- a cross-case dashboard restricted to the case IDs in a signed credential
- PostgreSQL priority history, alert lifecycle metadata, and replay-safe writes

No rule automatically freezes an account, blocks a payment, attributes intent, or exposes a historical case ID. `ALERT_BANK` and `ALERT_LEA` are recommended authorised actions; execution remains in the existing governed Case Action pipeline.

## Priority policy v1

The score is a deterministic operational triage score:

| Evidence component                                | Maximum contribution |
| ------------------------------------------------- | -------------------: |
| attributable exposure relative to reported amount |                   30 |
| highest current-graph Mule Risk score             |                   25 |
| cross-case linkage                                |                   15 |
| exit mode                                         |                   15 |
| temporal horizon and forecast confidence          |                   15 |

Complaint lag is an explanation-only feature and contributes zero points. A trusted `CLEARED` outcome resets operational priority to zero. A trusted outcome never comes from complaint text or behavioural evidence alone.

An active intervention window requires all of the following:

1. `CASH_OUT_LIKELY` exit mode;
2. an Evidence Gate decision other than `ABSTAIN`;
3. an urgent highest-risk bucket up to `1_TO_2_HOURS`; and
4. sufficient deterministic forecast confidence.

Stationary funds or explicit forecast abstention remain in `MONITORING`.

## HTTP API

All writes require `Idempotency-Key`.

| Method | Endpoint                                            | Trust requirement                                               |
| ------ | --------------------------------------------------- | --------------------------------------------------------------- |
| `POST` | `/api/v1/cases/:caseId/priority`                    | case-scoped `CASE_WRITE`                                        |
| `GET`  | `/api/v1/cases/:caseId/priority/latest`             | case-scoped `CASE_READ`                                         |
| `GET`  | `/api/v1/cases/:caseId/alerts`                      | case-scoped `CASE_READ`                                         |
| `POST` | `/api/v1/cases/:caseId/alerts/:alertId/acknowledge` | case-scoped `CASE_WRITE`                                        |
| `POST` | `/api/v1/cases/:caseId/alerts/:alertId/resolve`     | supervisor, case-scoped `CASE_WRITE`                            |
| `GET`  | `/api/v1/command-center`                            | `COMMAND_CENTER_READ`; response limited to credential `caseIds` |

Alert acknowledgement and resolution bodies use:

```json
{
  "rationale": "Evidence reviewed and the authorised response has been coordinated."
}
```

## Persistence and delivery

Migration `009_trust_command_center_scope.sql` persists the multi-case scope carried by a command-center trust session. Migration `010_command_center.sql` adds immutable priority snapshots, lifecycle-aware alerts, and lifecycle idempotency.

A priority write and its alert/outbox record commit in one PostgreSQL transaction. The worker's `ALERT_DISPATCH` handler then replays the already-persisted alert idempotently and emits the development structured-log notification. This keeps the alert visible immediately while retaining durable delivery and dead-letter behaviour.

## Verification

```bash
npm run demo:verify
npm run check
```

The golden verification covers the intervention case, stationary/abstention case, priority replay, credential scope, alert acknowledgement, investigator resolution denial, supervisor resolution, and dashboard ordering/counts.
