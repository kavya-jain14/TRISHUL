# Phase 1 - complaint-to-trace vertical slice

## End-to-end flow

1. `POST /api/v1/complaints` creates a `REPORTED` case from a complaint and original transaction reference.
2. `POST /api/v1/cases/:caseId/resolve-transaction` accepts a provenance-backed provider resolution and advances the case to `ACTIVE`.
3. `POST /api/v1/cases/:caseId/provider-events` appends validated provider events to a conflict-safe chronological ledger.
4. `POST /api/v1/cases/:caseId/trace` reduces ledger evidence into a versioned graph and advances the case to `TRACE`.
5. `GET /api/v1/cases/:caseId/graph` returns the latest immutable graph snapshot.
6. `GET /api/v1/cases/:caseId/ledger` exposes the case-scoped provider event timeline.
7. The Case Intelligence UI renders only the returned graph, displays the observation boundary, and exposes provenance for every edge.

Every write requires an `Idempotency-Key` header.

## Replay and conflict semantics

| Situation                                     | Result                                     |
| --------------------------------------------- | ------------------------------------------ |
| Same idempotency key + same request           | Stored response is replayed                |
| Same idempotency key + different request      | `409 IDEMPOTENCY_KEY_REUSED`               |
| Same provider event ID + same content         | Counted as duplicate; ledger is unchanged  |
| Same provider event ID + different content    | `409 PROVIDER_EVENT_CONFLICT`              |
| Provider events before transaction resolution | `409 CASE_NOT_RESOLVED`                    |
| Graph requested before TRACE                  | `409 GRAPH_NOT_AVAILABLE`                  |
| Event without provenance                      | `400 VALIDATION_ERROR`; no edge is created |

## Ordering and versioning

- Provider events are stored and traced by `occurredAt`, then `eventId`, not arrival order.
- A TRACE run increments `graphVersion` only when graph evidence changes.
- Replaying TRACE never duplicates an edge or graph version.
- A new downstream event requires a new TRACE idempotency key and creates the next immutable graph snapshot.
- The graph always states where authorised provider visibility currently ends.

## Persistence modes

- `POSTGRESQL`: selected when `DATABASE_URL` is configured. Persists the raw event ledger, normalised transactions, processed-event state, immutable graph snapshots, nodes, edges, cases, complaints, and idempotency responses.
- `IN_MEMORY_DEVELOPMENT_ADAPTER`: used when no database URL is configured. It supports the same service contract but is intentionally non-durable.

Run PostgreSQL migrations before starting the configured API:

```bash
npm run db:migrate
```

## Golden demo

The Case Intelligence screen can run the labelled `full-pipeline-reforecast` synthetic scenario. The browser resets and reads events from `apps/psp-sandbox`, routes the resolver event and downstream events through API write endpoints, runs TRACE, and then fetches the graph back from the API. It never constructs an edge locally.

Expected Phase 1 graph:

- 8 provider events persisted and processed
- 6 graph edges: original payment, four downstream transfers, and one observed cash-out edge
- provenance on every edge
- one immutable graph snapshot
- coverage boundary ending at the observed cash-out event

## Verified acceptance

- Complaint creation and all writes require idempotency keys.
- Complaint, resolver, event batch, and TRACE replays are safe.
- Same-ID/different-content provider events are rejected in service and PostgreSQL race boundaries.
- Out-of-order provider events generate a chronological graph.
- Missing provenance fails before graph mutation.
- Graph state does not regress and versions do not duplicate.
- PostgreSQL repository survives service recreation with case, ledger, graph, and idempotency state intact.
- Browser orchestration passes against real in-process API and PSP sandbox instances.
- Loading, error, pre-TRACE, empty, graph, boundary, and provenance UI states are explicit.

## Next phase

Delivered in [Phase 2](PHASE_2_EXPOSURE_RISK.md): fraud-attributable exposure snapshots plus behaviour/network-driven mule-risk states, wired to node drill-down without treating one complaint or one fast transfer as proof.
