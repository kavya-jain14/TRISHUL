# Domain worker handlers

The durable worker now executes every declared backend operation through the canonical Fastify API.
This keeps case-state and idempotency policy in one service instead of duplicating it inside the
worker process.

## Job mappings

| Job type                | Canonical operation                             |
| ----------------------- | ----------------------------------------------- |
| `TRACE_GRAPH_EXPANSION` | `POST /api/v1/cases/:caseId/trace`              |
| `EXPOSURE_RECOMPUTE`    | `POST /api/v1/cases/:caseId/recompute-exposure` |
| `RISK_REASSESSMENT`     | `POST /api/v1/accounts/:accountId/risk`         |
| `FORECAST_REFRESH`      | Exit mode, Evidence Gate, then forecast ranking |
| `EVIDENCE_ANCHOR`       | `POST /api/v1/cases/:caseId/evidence-anchors`   |

Every job carries the idempotency keys required by its API operations. Re-delivery after a worker
crash therefore returns the canonical replay instead of creating another graph, snapshot, risk
assessment, forecast, or anchor.

## Configuration and security boundary

- `TRISHUL_API_BASE_URL` defaults to `http://127.0.0.1:4000` for local development.
- `TRISHUL_INTERNAL_SERVICE_TOKEN` is optional until Vatsal's trust/access layer supplies an
  internal service credential. When configured, the worker sends it as a bearer token.
- `TRISHUL_API_TIMEOUT_MS` bounds every API call. Lease loss and process shutdown also abort an
  in-flight request, leaving the idempotent job available for safe redelivery.
- Non-HTTPS API URLs are rejected, so an internal service token cannot cross a cleartext connection.
  HTTP is restricted to loopback hosts in local development.
- API failure bodies and submitted evidence are never copied into worker logs.

The worker does not infer missing forecast inputs or alert policy. Producers must enqueue validated,
provenance-backed payloads from the owning domain service.
