import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { AlertWorker } from "../../worker/src/persistent-worker.ts";
import { PostgresAlertRepository } from "./alerts.ts";
import { PostgresCaseRepository } from "./cases.ts";
import { PostgresOutboxRepository } from "./outbox.ts";
import { PostgresPaymentEventRepository } from "./postgres.ts";
import { PostgresTraceRepository } from "./trace.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const baseTime = "2026-08-24T10:00:00.000Z";

test("PostgreSQL persists cases, traces, alerts, retries, dead letters, and replay", { skip: databaseUrl === undefined }, async () => {
  assert.ok(databaseUrl);
  const schema = `fuzail_it_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^fuzail_it_[a-f0-9]+$/);
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString: databaseUrl, max: 4, options: `-c search_path=${schema}` });

  try {
    for (const migrationPath of [
      "packages/database/migrations/001_fuzail_ledger_outbox.sql",
      "packages/database/migrations/002_fuzail_operations.sql"
    ]) {
      await pool.query(await readFile(migrationPath, "utf8"));
    }

    const cases = new PostgresCaseRepository(pool);
    const created = await cases.createFromComplaint({
      caseId: "case-integration-1",
      complaintId: "complaint-integration-1",
      transactionId: "txn-integration-a",
      amountPaise: 50_000,
      reportedAt: baseTime,
      fraudContext: "Integration-test complaint",
      payerReference: "payer-1",
      beneficiaryReference: "beneficiary-1",
      sourceUrls: ["https://example.test/complaints/1"],
      idempotencyKey: "complaint-integration-1"
    });
    assert.equal(created.status, "CREATED");
    assert.equal((await cases.get("case-integration-1"))?.currentState, "REPORTED");

    const payments = new PostgresPaymentEventRepository(pool);
    await payments.ingest(event({ eventId: "event-a", transactionId: "txn-integration-a", idempotencyKey: "event-a", sequence: 0, fromAccountId: "payer", toAccountId: "mule", occurredAt: baseTime }));
    await payments.ingest(event({ eventId: "event-b", transactionId: "txn-integration-b", idempotencyKey: "event-b", sequence: 0, fromAccountId: "mule", toAccountId: "cash-out", occurredAt: "2026-08-24T10:01:00.000Z" }));
    const traces = new PostgresTraceRepository(pool);
    const trace = await traces.trace({ caseId: "case-integration-1", transactionId: "txn-integration-a", maxHops: 4 });
    assert.deepEqual(trace.events.map((item) => item.eventId), ["event-a", "event-b"]);

    const outbox = new PostgresOutboxRepository(pool);
    const alerts = new PostgresAlertRepository(pool);
    const alertPayload = {
      alertId: "alert-integration-1",
      caseId: "case-integration-1",
      severity: "HIGH" as const,
      kind: "TRACE_RISK" as const,
      title: "Connected cash-out path",
      message: "Funds reached a cash-out account.",
      sourceUrls: ["https://example.test/evidence/1"],
      createdAt: baseTime
    };
    await outbox.enqueue({ type: "ALERT", payload: alertPayload, idempotencyKey: "alert-job-integration-1", createdAt: baseTime });
    const alertJob = await outbox.claimNext("ALERT", "alert-worker-it", baseTime);
    assert.ok(alertJob);
    await new AlertWorker(alerts).handle(alertJob.payload);
    await outbox.succeed(alertJob.jobId, "alert-worker-it", baseTime);
    assert.equal((await alerts.listForCase("case-integration-1")).length, 1);

    await outbox.enqueue({ type: "TRACE_REFRESH", payload: { transactionId: "always-fails" }, idempotencyKey: "dead-job-integration-1", createdAt: baseTime });
    const attemptTimes = [baseTime, "2026-08-24T10:00:02.000Z", "2026-08-24T10:00:05.000Z"];
    for (const [index, attemptedAt] of attemptTimes.entries()) {
      const claimed = await outbox.claimNext("TRACE_REFRESH", "trace-worker-it", attemptedAt);
      assert.ok(claimed);
      const outcome = await outbox.fail(claimed, "trace-worker-it", attemptedAt, "forced integration failure");
      assert.equal(outcome, index === 2 ? "DEAD_LETTERED" : "RETRY_SCHEDULED");
    }
    const deadLetters = await outbox.listOpenDeadLetters();
    assert.equal(deadLetters.length, 1);
    await outbox.replayDeadLetter(deadLetters[0]!.deadLetterId, "integration-test", "2026-08-24T10:00:06.000Z");
    const replayed = await outbox.claimNext("TRACE_REFRESH", "trace-worker-it", "2026-08-24T10:00:06.000Z");
    assert.ok(replayed);
    assert.equal(await outbox.fail(replayed, "trace-worker-it", "2026-08-24T10:00:06.000Z", "fails after replay"), "RETRY_SCHEDULED");
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  }
});

function event(input: {
  eventId: string;
  transactionId: string;
  idempotencyKey: string;
  sequence: number;
  fromAccountId: string;
  toAccountId: string;
  occurredAt: string;
}): unknown {
  return {
    ...input,
    amountPaise: 50_000,
    channel: "UPI",
    provenance: { providerId: "integration-bank", providerReference: input.eventId, recordedAt: input.occurredAt },
    intelligence: { complaintLinkCount: 1, sharedDeviceCount: 0, reportedMuleProximity: 0, priorCashOutCount: 0, geoCandidates: [] },
    source: "AUTHORISED_PARTNER"
  };
}
