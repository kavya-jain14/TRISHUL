# Phase 4 — Zone, Time, and Reforecast

Phase 4 converts a current, evidence-gated graph into bounded operational forecasts. It never
infers intent, never returns an exact ATM, and never returns an exact event minute.

## Runtime sequence

1. TRACE produces a new immutable graph version.
2. Exposure, account risk, exit mode, and the independent geo/time Evidence Gates are recomputed
   for that graph version.
3. `POST /api/v1/cases/:caseId/predictions` ranks only the dimensions whose gates passed.
4. `GET /api/v1/cases/:caseId/predictions/latest` returns only a forecast matching the current
   graph version. A graph advance makes the previous forecast unavailable as a current output.
5. The next successful forecast links to the prior run through `previousPredictionRunId` and emits
   `REFORECAST_AFTER_GRAPH_CHANGE`.

Every write requires an `Idempotency-Key`. A case may have at most one immutable forecast per graph
version; changed inputs require a new graph version.

## Zone policy

The prototype zone score follows the locked blueprint:

```text
0.35 account history
+ 0.30 connected-network history
+ 0.15 recency
+ 0.10 time-of-day similarity
+ 0.10 amount similarity
```

Scores are normalised into at most three ranked zones plus an `otherProbability`. The response
includes reason codes and per-feature contributions. Candidate evidence must come from a bank, PSP,
financial institution, or explicitly labelled simulator. Complaint-only evidence is rejected.

## Time policy

The API returns probabilities across all five non-overlapping buckets:

- under 30 minutes
- 30–60 minutes
- 1–2 hours
- 2–6 hours
- 6–24 hours

The interpretable time ranker uses a versioned prototype policy combining account and network delay
history, amount similarity, velocity alignment, temporal pattern, hop depth, and similar-case timing.
These weights are deterministic demo policy—not a production accuracy or scientific-validation
claim.

## Independent abstention

Geo and time are gated independently. A partial result contains one ranked dimension and one
explicit abstention. If exit mode is stationary, or evidence is insufficient, a persisted forecast
may contain abstention for both dimensions with confidence `0`. Missing evidence is never replaced
with invented candidates.

## Persistence and auditability

The canonical Phase 4 rows in `prediction_runs` store the graph version, Evidence Gate reference,
previous forecast reference, calculation-input hash, model/feature/rule versions, outputs,
confidence, reason codes, and timestamp.
This preserves reforecast lineage and makes replay or stale-output detection deterministic.
