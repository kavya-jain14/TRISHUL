# Phase 3 - exit mode and Evidence Gate vertical slice

## End-to-end flow

Phase 3 starts only after the latest TRACE graph has current exposure and account-risk snapshots.

1. `POST /api/v1/cases/:caseId/exit-mode` derives graph and account features, combines them with provenance-backed provider history, and ranks `STATIONARY`, `FORWARD`, and `CASH_OUT_LIKELY`.
2. `GET /api/v1/cases/:caseId/exit-mode/latest` returns the immutable result for the current graph version.
3. `POST /api/v1/cases/:caseId/forecast` evaluates geo and time evidence independently. It does not rank zones or time horizons.
4. `GET /api/v1/cases/:caseId/forecast/latest` returns current forecast readiness, abstention reasons, and missing evidence.

Every write requires an `Idempotency-Key`. One exit-mode snapshot and one Evidence Gate snapshot can exist for a case and graph version. A replay with changed evidence is rejected instead of rewriting history.

## Exit-mode boundary

The deterministic classifier evaluates:

- recent incoming and outgoing velocity;
- retained exposure and pass-through behaviour;
- historical stationary, forwarding, and cash-out proportions;
- graph hop depth;
- inactivity, cash-out tendency, and evidence strength.

Historical exit-mode proportions must sum to one. Prediction inputs must have BANK, PSP, FI, or labelled SIMULATOR provenance. Complaint-derived aggregate signals are rejected. The result describes an observed or evidence-supported movement mode and never infers intent.

The mode ranking remains separate from confidence: evidence strength calibrates the selected-mode confidence downward without changing which mode the underlying features support.

Money arriving at an account is not treated as proof of an ATM cash-out. Exit mode is assessed before any geo or time forecast can proceed.

## Independent Evidence Gates

Geo and time use the same versioned coverage formula, but they receive and return separate evidence:

```text
coverage = 0.35(account_history)
         + 0.30(network_history)
         + 0.20(graph_confidence)
         + 0.15(historical_support)
```

Coverage states are `HIGH`, `MEDIUM`, `LOW`, and `INSUFFICIENT`. A dimension passes only when:

- coverage is HIGH or MEDIUM;
- prediction stability is at least 0.60;
- account or connected-network cash-out history is at least 0.60;
- graph confidence is at least 0.65;
- historical support is at least 0.50; and
- exit mode is `CASH_OUT_LIKELY`.

The overall readiness result is:

| Geo     | Time    | Overall |
| ------- | ------- | ------- |
| PASS    | PASS    | PREDICT |
| PASS    | ABSTAIN | PARTIAL |
| ABSTAIN | PASS    | PARTIAL |
| ABSTAIN | ABSTAIN | ABSTAIN |

`PARTIAL` means only the supported dimension may proceed to the future ranker. `ABSTAIN` is a valid operational output, not an error. Every abstention includes missing-evidence reason codes.

## Phase boundary

Phase 3 stores forecast readiness only. It intentionally does not return:

- geo-zone candidates;
- maps or exact ATM claims;
- time-horizon candidates;
- countdowns or cash-out guarantees.

Those outputs belong to Phase 4 and can run only for dimensions that pass this gate.

## Persistence and invalidation

- PostgreSQL stores immutable `exit_mode_snapshots` and `evidence_gate_snapshots` with graph, feature, model, rule, input-hash, provenance, and evaluation metadata.
- The in-memory adapter implements the same repository contract.
- A changed TRACE graph returns cases from `EXPOSURE`, `RISK_ASSESSED`, `EXIT_MODE`, `EVIDENCE_GATE`, `PREDICT`, or `ABSTAIN` to `TRACE`.
- Prior snapshots remain historical, while current getters withhold them until the new graph is recomputed.
- Repository/service recreation tests prove Phase 3 snapshots are reloaded through the PostgreSQL adapter rather than process memory.

## Prediction Workspace

The Geo / Prediction module exposes two deterministic real-client flows:

- Supported path: the provider window stops before cash-out or outcome events. Authorised cash-out history and tendency rank `CASH_OUT_LIKELY`; geo passes while weak time evidence abstains, proving independent gating without outcome leakage.
- Stationary path: funds have no downstream movement, `STATIONARY` ranks first, and both dimensions intentionally abstain even when their coverage inputs are otherwise strong.

The workspace shows ranked exit modes, coverage and stability, provenance, pass/abstain state, and missing evidence. It renders no invented map, zone, or time horizon.

## Verified acceptance

- All three exit modes are covered by deterministic unit tests.
- The supported demo ranks likely cash-out before the simulator releases cash-out or outcome events.
- The blueprint coverage formula is asserted exactly in a unit test.
- Geo and time pass or abstain independently.
- Stationary mode forces a correct abstention instead of a forecast.
- Complaint-sourced prediction features are rejected.
- Same-version evidence cannot be silently rewritten.
- A changed TRACE graph invalidates current exit-mode and gate reads.
- PostgreSQL-adapter recreation and real API/simulator/browser-client orchestration cover supported and stationary paths.

## Next phase

Phase 4 will rank evidence-supported geo zones and time buckets, reforecast on new provider events, and continue to withhold unsupported dimensions.
