import assert from "node:assert/strict";
import test from "node:test";
import type { PersistentOutboxJob, QueueHealth, QueueMetrics } from "../../database/src/outbox.ts";
import { JsonStructuredLogger } from "./observability.ts";
import { AlertWorker, PersistentOutboxWorker, type PersistentQueue } from "./persistent-worker.ts";

const now = "2026-08-24T10:00:00.000Z";

function job(payload: unknown = { transactionId: "txn-1" }): PersistentOutboxJob {
  return {
    jobId: "job-1",
    type: "TRACE_REFRESH",
    payload,
    idempotencyKey: "trace:txn-1",
    status: "PROCESSING",
    availableAt: now,
    createdAt: now,
    lockedBy: "worker-1",
    leaseExpiresAt: "2026-08-24T10:00:30.000Z",
    maxAttempts: 3
  };
}

class FakeQueue implements PersistentQueue {
  next: PersistentOutboxJob | undefined = job();
  failureResult: "RETRY_SCHEDULED" | "DEAD_LETTERED" = "RETRY_SCHEDULED";
  succeeded: string[] = [];
  failed: string[] = [];

  async claimNext(): Promise<PersistentOutboxJob | undefined> { return this.next; }
  async succeed(jobId: string): Promise<void> { this.succeeded.push(jobId); }
  async fail(failedJob: PersistentOutboxJob): Promise<"RETRY_SCHEDULED" | "DEAD_LETTERED"> {
    this.failed.push(failedJob.jobId);
    return this.failureResult;
  }
  async metrics(): Promise<QueueMetrics> {
    return { counts: { PENDING: 1, PROCESSING: 0, COMPLETED: 0, FAILED: 0 }, openDeadLetters: 0, oldestPendingAgeMs: 1000 };
  }
  async health(): Promise<QueueHealth> {
    return { status: "HEALTHY", databaseReachable: true, checkedAt: now };
  }
}

test("persistent worker completes a leased job and emits structured lifecycle logs", async () => {
  const queue = new FakeQueue();
  const lines: string[] = [];
  const worker = new PersistentOutboxWorker({
    queue,
    workerId: "worker-1",
    logger: new JsonStructuredLogger("test-worker", (line) => lines.push(line)),
    handlers: { TRACE_REFRESH: async () => undefined }
  });

  assert.equal(await worker.processOne("TRACE_REFRESH", now), "PROCESSED");
  assert.deepEqual(queue.succeeded, ["job-1"]);
  assert.deepEqual(lines.map((line) => JSON.parse(line).event), ["outbox_job_claimed", "outbox_job_completed"]);
  assert.equal((await worker.health(now)).status, "HEALTHY");
  assert.equal((await worker.metrics(now)).counts.PENDING, 1);
});

test("persistent worker reports dead-letter outcome after handler failure", async () => {
  const queue = new FakeQueue();
  queue.failureResult = "DEAD_LETTERED";
  const lines: string[] = [];
  const worker = new PersistentOutboxWorker({
    queue,
    workerId: "worker-1",
    logger: new JsonStructuredLogger("test-worker", (line) => lines.push(line)),
    handlers: { TRACE_REFRESH: async () => { throw new Error("forecast service unavailable"); } }
  });

  assert.equal(await worker.processOne("TRACE_REFRESH", now), "DEAD_LETTERED");
  assert.deepEqual(queue.failed, ["job-1"]);
  assert.equal(JSON.parse(lines.at(-1) ?? "{}").level, "ERROR");
});

test("alert worker validates and persists an alert payload", async () => {
  const persisted: unknown[] = [];
  const worker = new AlertWorker({ persist: async (alert) => { persisted.push(alert); } });
  await worker.handle({
    alertId: "alert-1",
    caseId: "case-1",
    severity: "HIGH",
    kind: "TRACE_RISK",
    title: "Rapid fund movement",
    message: "Four connected hops were detected.",
    sourceUrls: ["https://example.test/evidence"],
    createdAt: now
  });
  assert.equal(persisted.length, 1);
});
