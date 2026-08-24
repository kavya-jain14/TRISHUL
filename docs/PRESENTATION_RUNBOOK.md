# TRISHUL presentation runbook

This is the presentation-safe path for the deterministic simulator. It does not require Docker,
PostgreSQL, Redis, bank credentials, NPCI access, or live internet data.

## Before leaving for the presentation

```bash
git switch main
git pull --ff-only origin main
npm install
npm run demo:smoke
```

The smoke test must pass both the supported forecast and stationary-abstention paths.

## Start the complete demo

```bash
npm run dev:demo
```

Open `http://localhost:5173`. The command starts the API on port `4000`, the deterministic PSP
sandbox on `4100`, and the web workspace on `5173`. Stop all three with `Ctrl+C`.

## Golden judge path

1. Open **Geo / Prediction**.
2. Click **Run supported forecast**.
3. Explain the visible sequence: complaint → provider events → TRACE graph → exposure range →
   explainable risk → exit mode → independent Evidence Gates → top zones + bounded time buckets.
4. Point out **Noida Sector 62** as the leading zone and **1–2 hours** as the leading time bucket.
5. Point to graph version, confidence, model/rule versions, and the “no exact ATM/minute” boundary.
6. Click **Run stationary abstention**.
7. Show that stationary funds persist explicit geo/time `ABSTAIN` with confidence `0` rather than a
   fabricated prediction.
8. Open **Case Intelligence** and load `case:complaint-golden-a` to show the five
   provenance-backed edges, coverage boundary, exposure ranges, and non-confirmed mule-risk logic.

Both buttons are deterministic and idempotent, so they can be run again without duplicating events
or graph versions.

## What to say if judges challenge the data

- The prototype uses a clearly labelled PSP simulator because it does not claim live NPCI, bank, or
  I4C access.
- Every graph edge and feature input carries provenance; complaint data alone cannot create a
  prediction or mule confirmation.
- Commingled funds are represented as an attributable range, not an invented exact fraud amount.
- Blockchain anchors evidence integrity and credentials; it does not trace private UPI transfers.
- Production integration replaces the simulator with authorised bank/PSP/FI connectors without
  changing the core contracts.

## Fast recovery

- If the browser looks stale, refresh and run the same scenario again.
- If a service stops, press `Ctrl+C` once and rerun `npm run dev:demo`.
- If ports are occupied, close earlier Node/Vite terminals before restarting.
- Keep this repository and dependencies available locally; the golden path itself needs no network.

## Case backend ownership note

The canonical `apps/api` Case module already owns complaint intake, idempotency, PostgreSQL
persistence, provider ledger, TRACE, graph, exposure, risk, exit mode, Evidence Gate, and forecast
lineage. Any older Case/Complaint stash must be compared against this module and may contribute only
genuinely missing behavior. It must not introduce a second migration stack, repository, service,
router, or API app before the presentation.
