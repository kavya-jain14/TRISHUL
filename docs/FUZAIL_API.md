# Fuzail backend API

All responses are JSON and include defensive security headers. `/health/live` and `/health/ready` are public for runtime probes. Every `/v1` route calls the injected `ApiAuthorizer` and fails closed when authorization is unavailable.

| Method | Route | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health/live` | Public | Process liveness |
| `GET` | `/health/ready` | Public | PostgreSQL and queue readiness |
| `POST` | `/v1/ledger/events` | `ledger:write` | Ingest an authorised provider event |
| `GET` | `/v1/ledger/transactions/:id/events` | `ledger:read` | Read ordered transaction events |
| `POST` | `/v1/traces/resolve` | `trace:read` | Resolve a case-scoped multi-hop trace |
| `POST` | `/v1/cases` | `case:write` | Persist a complaint and case |
| `GET` | `/v1/cases/:id` | `case:read` | Read current case state |
| `POST` | `/v1/cases/:id/states` | `case:write` | Append a case-state event |
| `GET` | `/v1/cases/:id/alerts` | `alert:read` | Read case alerts |
| `POST` | `/v1/alerts/:id/acknowledge` | `alert:write` | Acknowledge an alert |
| `GET` | `/v1/operations/queue/metrics` | `operations:read` | Read queue metrics |
| `GET` | `/v1/operations/dead-letters` | `operations:read` | List open dead letters |
| `POST` | `/v1/operations/dead-letters/:id/replay` | `operations:write` | Replay a dead-lettered job |

The authorization adapter receives the raw authorization header, required permission, and case ID when the route is case-scoped. Vatsal's credential, nonce, revocation, and ZKP checks belong behind that adapter.
