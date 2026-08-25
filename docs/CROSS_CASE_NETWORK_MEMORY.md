# Cross-case network memory

## Boundary

Cross-case network memory compares the latest TRACE graph for one case with the latest versioned graphs from other cases. It detects observable account reuse, downstream convergence, and repeated directed payment edges. It never infers intent, confirms fraud, or turns a complaint into an account blacklist.

Public results contain opaque `matchReference` values rather than historical case IDs. Shared account references are returned only when those accounts already appear in the current case graph. The module does not add inferred graph edges or expose KYC/PII.

## Outcome-aware evidence

Each matching historical case is weighted independently:

| Institutional outcome      | Multiplier | Meaning                                        |
| -------------------------- | ---------- | ---------------------------------------------- |
| `CONFIRMED`                | `1.00`     | Full weight from a trusted institutional event |
| `SUSPECTED`                | `0.60`     | Material but explicitly discounted suspicion   |
| `NO_INSTITUTIONAL_OUTCOME` | `0.35`     | Weak network memory; never proof by itself     |
| `CLEARED`                  | `0.00`     | Excluded from the linkage score                |

Only processed `OUTCOME` events from a bank, PSP, FI, or labelled simulator receive an institutional outcome weight. Complaint- or analyst-sourced outcome claims are downgraded to `NO_INSTITUTIONAL_OUTCOME`.

For each current account, similarity uses direct account reuse (45%), up to three hops of shared downstream accounts (35%), and repeated directed financial edges (20%). Independent match weights are aggregated as `1 - product(1 - matchWeight)`. A lone unresolved direct-account reuse therefore scores `0.1575`, not a confirmation or blacklist decision.

## API and persistence

- `POST /api/v1/cases/:caseId/network-correlation` requires `Idempotency-Key` and creates an immutable versioned snapshot for the latest graph.
- `GET /api/v1/cases/:caseId/network-correlation/latest` returns the latest snapshot.
- Production Trust Access automatically requires `CASE_WRITE` for the POST and `CASE_READ` for the GET because both routes are case scoped.
- PostgreSQL migration `008_cross_case_network_memory.sql` stores the input hash, rule version, graph version, evaluated time, and validated result. Reusing a case/key pair with changed graph or history returns `409 NETWORK_MEMORY_IDEMPOTENCY_CONFLICT`.

After a correlation run, Mule Risk uses the persisted internal `crossCaseLinkage` for the same case, graph version, and account instead of a provider-supplied placeholder. The resulting mule assessment records `crossCaseCorrelationRunId` for audit linkage. All other provider signals retain their authorised provenance, and only a trusted institutional outcome can produce `CONFIRMED`.

Run correlation before the first Mule Risk assessment for a graph version. Mule assessments are immutable for a case, graph version, and account; if TRACE creates a new graph version, run correlation again before assessing that version.
