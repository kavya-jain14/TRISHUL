import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { TransactionEvent } from "../../../packages/ledger/src/schema.ts";
import { DenyAllAuthorizer, type ApiAuthorizer, type AuthorizationRequest } from "./auth.ts";
import { createApiServer, type ApiDependencies } from "./server.ts";

const now = "2026-08-24T10:00:00.000Z";

function dependencies(overrides: Partial<ApiDependencies> = {}): ApiDependencies {
  const authorizer: ApiAuthorizer = {
    async authorize() { return { subject: "investigator-1", roles: ["LAW_ENFORCEMENT"] }; }
  };
  return {
    authorizer,
    cases: {
      async createFromComplaint(request) { return { status: "CREATED", case: { caseId: (request as { caseId: string }).caseId, currentState: "REPORTED", version: 1, createdAt: now, updatedAt: now } }; },
      async appendState(input) { return { status: "APPENDED", case: { caseId: (input as { caseId: string }).caseId, currentState: "TRACE", version: 2, createdAt: now, updatedAt: now } }; },
      async get(caseId) { return { caseId, currentState: "REPORTED", version: 1, createdAt: now, updatedAt: now }; }
    },
    alerts: {
      async listForCase() { return []; },
      async acknowledge(alertId, acknowledgedAt) { return { alertId, caseId: "case-1", severity: "HIGH", kind: "TRACE_RISK", title: "Risk", message: "Risk detected", sourceUrls: [], createdAt: now, acknowledgedAt }; }
    },
    operations: {
      async metrics() { return { counts: { PENDING: 0, PROCESSING: 0, COMPLETED: 1, FAILED: 0 }, openDeadLetters: 0, oldestPendingAgeMs: null }; },
      async health(checkedAt) { return { status: "HEALTHY", databaseReachable: true, checkedAt }; },
      async listOpenDeadLetters() { return []; },
      async replayDeadLetter(_deadLetterId, _replayedBy, replayedAt) { return { jobId: "job-1", type: "ALERT", payload: {}, idempotencyKey: "alert-1", status: "PENDING", availableAt: replayedAt, createdAt: now, lockedBy: null, leaseExpiresAt: null, maxAttempts: 3 }; }
    },
    traces: {
      async trace(seed) { return { seed: seed as { caseId: string; transactionId: string; maxHops: number }, events: [], hopCount: 0, terminalAccountIds: [] }; }
    },
    ledger: {
      async ingest(event) { return { status: "APPENDED", event: event as TransactionEvent }; },
      async listForTransaction() { return []; }
    },
    logger: { log() {} },
    clock: () => new Date(now),
    ...overrides
  };
}

async function withServer<T>(deps: ApiDependencies, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createApiServer(deps, { maxBodyBytes: 256 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

test("health is public but protected routes deny access without an authorizer grant", async () => {
  await withServer(dependencies({ authorizer: new DenyAllAuthorizer() }), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health/ready`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");

    const protectedResponse = await fetch(`${baseUrl}/v1/operations/queue/metrics`);
    assert.equal(protectedResponse.status, 401);
    assert.equal((await protectedResponse.json() as { error: { code: string } }).error.code, "AUTHENTICATION_REQUIRED");
  });
});

test("trace route passes through the permission boundary and validates JSON content type", async () => {
  const authorizationRequests: AuthorizationRequest[] = [];
  const authorizer: ApiAuthorizer = {
    async authorize(request) {
      authorizationRequests.push(request);
      return { subject: "analyst-1", roles: ["BANK_ANALYST"] };
    }
  };
  await withServer(dependencies({ authorizer }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/traces/resolve`, {
      method: "POST",
      headers: { authorization: "Bearer opaque-presentation", "content-type": "application/json" },
      body: JSON.stringify({ caseId: "case-1", transactionId: "txn-1", maxHops: 4 })
    });
    assert.equal(response.status, 200);
    assert.equal(authorizationRequests[0]?.permission, "trace:read");
    assert.equal(authorizationRequests[0]?.authorizationHeader, "Bearer opaque-presentation");
  });
});

test("ledger ingestion requires the dedicated write permission", async () => {
  const permissions: string[] = [];
  const deps = dependencies({
    authorizer: {
      async authorize(request) {
        permissions.push(request.permission);
        return { subject: "provider-adapter-1", roles: ["AUTHORISED_PARTNER"] };
      }
    }
  });
  await withServer(deps, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ledger/events`, {
      method: "POST",
      headers: { authorization: "Bearer provider-token", "content-type": "application/json" },
      body: JSON.stringify({ eventId: "event-1" })
    });
    assert.equal(response.status, 201);
    assert.deepEqual(permissions, ["ledger:write"]);
  });
});

test("case state route trusts the path case ID instead of a conflicting body value", async () => {
  let received: unknown;
  const deps = dependencies();
  deps.cases.appendState = async (input) => {
    received = input;
    return { status: "APPENDED", case: { caseId: "case-safe", currentState: "TRACE", version: 2, createdAt: now, updatedAt: now } };
  };
  await withServer(deps, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/cases/case-safe/states`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ caseId: "case-attacker", state: "TRACE", rationale: "Trace started", sourceUrls: [], occurredAt: now, idempotencyKey: "state-1" })
    });
    assert.equal(response.status, 200);
    assert.equal((received as { caseId: string }).caseId, "case-safe");
  });
});

test("dead-letter replay records the authenticated principal", async () => {
  let replayedBy: string | undefined;
  const deps = dependencies();
  deps.operations.replayDeadLetter = async (_id, principal, replayedAt) => {
    replayedBy = principal;
    return { jobId: "job-1", type: "ALERT", payload: {}, idempotencyKey: "alert-1", status: "PENDING", availableAt: replayedAt, createdAt: now, lockedBy: null, leaseExpiresAt: null, maxAttempts: 3 };
  };
  await withServer(deps, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/operations/dead-letters/dead-1/replay`, {
      method: "POST",
      headers: { authorization: "Bearer token" }
    });
    assert.equal(response.status, 200);
    assert.equal(replayedBy, "investigator-1");
  });
});
