# Golden backend demo runbook

This is the deterministic offline-safe backend path for a presentation. It does not depend on a production bank, NPCI, I4C, a trained model, or an external blockchain.

## Preflight

```bash
npm ci
npm run demo:verify
npm run check
```

For the durable PostgreSQL mode:

```bash
cp .env.example .env
docker compose up -d postgres redis
npm run db:migrate
```

For the lowest-risk presentation fallback, leave `DATABASE_URL` unset. The API then uses its in-memory development adapter and the PSP sandbox remains deterministic.

## Start

Use separate terminals:

```bash
npm run dev:api
npm run dev:psp
```

The separately owned frontend can connect to these two services; this backend checkpoint does not move frontend code into the backend stack.

Health checks:

```bash
curl -fsS http://127.0.0.1:4000/api/v1/health
curl -fsS http://127.0.0.1:4100/api/v1/health
```

## Scenario A: intervention and reforecast

The `full-pipeline-reforecast` PSP scenario contains the locked ₹50,000 path:

1. T1001 payment;
2. A -> B ₹35,000 and A -> C ₹15,000;
3. B -> D ₹30,000;
4. later D -> E hop;
5. labelled cash-out and institutional outcome.

Before presenting it, reset its cursor:

```bash
curl -fsS -X POST http://127.0.0.1:4100/api/v1/scenarios/full-pipeline-reforecast/reset
```

The verified backend path produces multi-hop TRACE, attributable exposure, explainable WATCH/SUSPECTED evidence, cash-out-likely exit mode, Noida/Ghaziabad/Delhi candidates, a `1_TO_2_HOURS` horizon, reforecast after a new hop, and Command Center priority/alert output.

## Scenario B: correct abstention

Reset the stationary scenario:

```bash
curl -fsS -X POST http://127.0.0.1:4100/api/v1/scenarios/stationary-abstention/reset
```

Stationary funds produce `ABSTAIN`, `MONITORING`, and no intervention alert. A later authoritative hop can advance the graph and trigger a new evidence/forecast cycle.

## Reset between runs

- PSP state: call both `/reset` endpoints above.
- In-memory API state: restart only the API process. No file or database deletion is required.
- Durable demo state: use a fresh demo database before the presentation; do not delete or truncate a shared team database.

## Presentation-safe claims

- TRISHUL traces provider-supplied financial events; blockchain is used only for evidence integrity.
- Forecasts can abstain and return top-k zones/time horizons rather than exact GPS certainty.
- Mule Risk is explainable and cannot confirm an account without a trusted institutional outcome.
- Command Center priority means operational urgency, not guilt.
- Bank/LEA alerts are governed recommendations and recorded actions, not autonomous freezes.

## Fallback order

1. live local in-memory API + PSP sandbox;
2. automated `npm run demo:verify` output;
3. the deterministic test assertions and stored scenario fixtures.

Do not make a production-integration claim when using the fallback adapter.
