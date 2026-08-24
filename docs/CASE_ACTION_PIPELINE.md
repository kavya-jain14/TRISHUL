# Case action persistence and worker pipeline

This Fuzail-owned integration records evidence-backed operational actions without deciding case-state
policy. It consumes Vatsal's canonical signed Trust/Access session instead of trusting client identity.

## API

- `POST /api/v1/cases/:caseId/actions` records an immutable action. The request requires an
  `Idempotency-Key` header.
- `GET /api/v1/cases/:caseId/actions` returns the case action timeline newest first.
- Both routes require a case-scoped Bearer trust session. The API derives `actorRef`, `actorRole`,
  and `purpose` from that session and applies an action-specific role policy.

Supported action types are `ALERT_BANK`, `ALERT_LEA`, `ESCALATE_CASE`, `ADD_ANALYST_NOTE`, and
`ADD_OUTCOME_NOTE`. Each action requires at least one verified, same-case evidence-anchor ID;
optional URLs are display metadata only. Actor, role, and purpose come from the signed trust session,
never from the request body. Recording an action does not itself
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

- API tests cover replay plus missing, forged, wrong-case, insufficient-capability, insufficient-role,
  client-asserted-identity, missing-anchor, and cross-case-anchor rejection.
- Shared-contract tests require rationale, timestamp, and evidence-anchor references; persisted events
  additionally require the verified actor, role, and purpose.
- PostgreSQL CI verifies atomic action/outbox commits, idempotent replay, and rollback when enqueueing
  the outbox event fails.
