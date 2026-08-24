# Fuzail backend handoff

## Ready now

- PostgreSQL migrations: `001_fuzail_ledger_outbox.sql` and `002_case_persistence.sql`.
- Atomic payment-event plus trace-refresh outbox write: `PostgresPaymentEventRepository`.
- Append-only case, complaint, graph-version, risk-snapshot, and forecast persistence: `PostgresCaseRepository`.
- In-memory workers already verify idempotency, retry/backoff, alerts, and evidence anchoring.

## Requires deployment configuration

- A PostgreSQL database and a migration runner for the supplied migration.
- A Redis instance plus a persistent worker runtime to replace the demo in-memory outbox.
- Server-side `DATABASE_URL` and `REDIS_URL`; do not expose either to frontend code.

## Needs another owner before integration

- **Vatsal:** issuer/credential-registry interface, revocation feed, and production proof format. Then replace `DemoTrustService` behind the existing trust boundary.
- **Kavya:** final core schema/graph-model approval before merging the migration; intelligence versioning and outcome-feedback rules.
- **Sandhya/Ujjwal/Vanshika:** consume the stable case, graph, evidence, forecast, alert, and access APIs in their screens. UI changes must not alter these contracts without review.

## Not a production claim

The current repository is a deterministic SIH demo prototype. It has no live bank/NPCI data, deployed PostgreSQL/Redis service, real issuer, or permissioned blockchain network.

