# Fuzail backend handoff

## Two-phase delivery plan

- **Phase 1 — durable backend foundation:** PostgreSQL workers, dead-letter/replay, health/metrics/logging, alerts, and case persistence.
- **Phase 2 — exposed integration:** isolated PostgreSQL integration tests and authenticated trace/ledger backend API routes.

## Ready now

- PostgreSQL migrations: `001_fuzail_ledger_outbox.sql` and `002_fuzail_operations.sql`.
- Atomic payment-event plus trace-refresh outbox write: `PostgresPaymentEventRepository`.
- Append-only case, complaint, graph-version, risk-snapshot, and forecast persistence: `PostgresCaseRepository`.
- PostgreSQL-leased workers with retry/backoff, expired-lease recovery, dead-lettering, and replay.
- Persistent alerts with acknowledgement and per-case timelines.
- Queue health, metrics, and JSON structured worker logs.
- In-memory workers remain available for deterministic demos and fast unit tests.

## Requires deployment configuration

- A PostgreSQL database and migration runner for the supplied migrations.
- A continuously running process that invokes `PersistentOutboxWorker` for each registered job type.
- Server-side `DATABASE_URL`; do not expose it to frontend code.

## Phase 2 remaining

- Run PostgreSQL integration tests against an isolated test database.
- Expose trace, ledger, case, alert, health, metrics, and dead-letter replay through authenticated API boundaries.

## Needs another owner before integration

- **Vatsal:** issuer/credential-registry interface, revocation feed, and production proof format. Then replace `DemoTrustService` behind the existing trust boundary.
- **Kavya:** final core schema/graph-model approval before merging the migration; intelligence versioning and outcome-feedback rules.
- **Sandhya/Ujjwal/Vanshika:** consume the stable case, graph, evidence, forecast, alert, and access APIs in their screens. UI changes must not alter these contracts without review.

## Not a production claim

The current repository has production-oriented persistence boundaries but no live bank/NPCI data, deployed PostgreSQL service, real issuer, or permissioned blockchain network.

