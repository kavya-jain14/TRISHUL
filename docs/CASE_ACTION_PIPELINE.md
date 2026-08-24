# Case action persistence and worker pipeline

This Fuzail-owned integration records evidence-backed operational actions without deciding case-state
policy or implementing trust verification.

## API

- `POST /api/v1/cases/:caseId/actions` records an immutable action. The request requires an
  `Idempotency-Key` header.
- `GET /api/v1/cases/:caseId/actions` returns the case action timeline newest first.
- Requests carry an `actorRef` and `purpose` as explicit authentication integration points. Vatsal's
  trust/access layer must replace client assertions with verified identity and purpose before a
  production deployment authorises these actions.

Supported action types are `ALERT_BANK`, `ALERT_LEA`, `ESCALATE_CASE`, `ADD_ANALYST_NOTE`, and
`MARK_OUTCOME`. Each action requires at least one evidence URL. Recording an action does not itself
change the case state; Sandhya's case workflow remains the authority for intervention and outcome
transitions.

## Transactional persistence

Migration `005_case_actions.sql` adds the immutable `case_actions` table and the
`CASE_ACTION_EVENT` outbox type. PostgreSQL writes the action and its durable outbox job in the same
transaction. An action cannot be committed without its worker event, and an idempotent replay does
not enqueue a duplicate event.

## Worker behavior

The continuously running worker validates the shared action-event contract and emits structured
development-adapter dispatch logs. The durable runtime supplies lease fencing, heartbeat renewal,
retry, dead-letter, replay, and queue metrics. A real bank/LEA notification adapter can replace the
development dispatch without changing the API or persistence contract.

## Verification

- API tests cover create, replay, conflict, listing, and unknown cases.
- Shared-contract tests require attributable actor, purpose, rationale, timestamp, and evidence.
- PostgreSQL CI verifies the action and outbox event are committed together and that replay does not
  duplicate either record.
