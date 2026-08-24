# Architecture

```mermaid
flowchart TD
    Web[Investigation workspace] --> API[Main API]
    Sandbox[Deterministic PSP sandbox] --> API
    API --> DB[(PostgreSQL)]
    API --> Queue[(Redis / jobs)]
    Queue --> Worker[Trace and reforecast worker]
    Worker --> DB
    Worker --> Core[Graph, risk, prediction packages]
    API --> Trust[Trust and audit packages]
```

## Runtime applications

| Application        | Responsibility                             | Phase 0 state                    |
| ------------------ | ------------------------------------------ | -------------------------------- |
| `apps/web`         | Command centre and investigation workspace | App shell and API readiness      |
| `apps/api`         | Validated, scoped HTTP boundary            | Health and system manifest       |
| `apps/worker`      | Trace/reforecast/alert job consumer        | Typed capability manifest        |
| `apps/psp-sandbox` | Replaceable deterministic provider adapter | Golden scenario sequencing/reset |

## Shared packages

| Package        | Responsibility                                                                               |
| -------------- | -------------------------------------------------------------------------------------------- |
| `contracts`    | Zod schemas, enums, provider events, graph provenance, forecast responses, state transitions |
| `database`     | PostgreSQL migration metadata and core versioned schema                                      |
| `graph`        | Fraud-attributable exposure and bounded graph utilities                                      |
| `intelligence` | Explainable behavioural/network assessment without intent inference                          |
| `prediction`   | Evidence Gate and prediction/abstention contracts                                            |
| `trust`        | Credential validity, revocation, role, purpose, and identity-resolution abstractions         |
| `audit`        | Canonical evidence hashing and future anchor-provider interface                              |

## Integration boundary

The simulator emits the same `ProviderEvent` contract expected from a future authorised bank/FI adapter. It is deterministic, labelled `SIMULATED`, and resettable. The frontend consumes API state and never manufactures financial edges.
