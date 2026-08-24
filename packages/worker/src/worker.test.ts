import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceAnchorLedger } from "../../ledger/src/evidence-anchor.ts";
import { SyntheticLedger } from "../../ledger/src/ledger.ts";
import { InMemoryOutbox } from "./outbox.ts";
import { EvidenceAnchorWorker, TraceRefreshWorker, TransactionEventPipeline } from "./worker.ts";

test("enqueues exactly one trace refresh for an idempotent transaction retry", () => {
  const pipeline = new TransactionEventPipeline(new SyntheticLedger(), new InMemoryOutbox());
  const event = { eventId: "event-1", transactionId: "transaction-1", idempotencyKey: "event-request-1", sequence: 0, occurredAt: "2026-08-24T10:00:00.000Z", fromAccountId: "account-a", toAccountId: "account-b", amountPaise: 100, channel: "UPI", source: "SYNTHETIC_LEDGER" };
  const first = pipeline.ingest(event);
  const second = pipeline.ingest(event);
  assert.equal(first.ledgerStatus, "APPENDED");
  assert.equal(second.ledgerStatus, "IDEMPOTENT_REPLAY");
  assert.equal(first.traceJob.jobId, second.traceJob.jobId);
});

test("retries a transient anchor failure and completes it without creating duplicate evidence anchors", () => {
  const outbox = new InMemoryOutbox();
  const anchors = new EvidenceAnchorLedger();
  let calls = 0;
  const worker = new EvidenceAnchorWorker(outbox, {
    anchor(rawInput) {
      calls += 1;
      if (calls === 1) throw new Error("Temporary anchor service failure");
      return anchors.anchor(rawInput);
    }
  });
  outbox.enqueue({ type: "EVIDENCE_ANCHOR", idempotencyKey: "anchor-job-1", createdAt: "2026-08-24T10:00:00.000Z", payload: { caseId: "case-1", evidenceId: "evidence-1", content: "original evidence", idempotencyKey: "anchor-1", anchoredAt: "2026-08-24T10:00:00.000Z" } });
  assert.equal(worker.processOne("2026-08-24T10:00:00.000Z"), "RETRY_SCHEDULED");
  assert.equal(worker.processOne("2026-08-24T10:00:01.000Z"), "PROCESSED");
  assert.equal(anchors.verify("evidence-1", "original evidence").valid, true);
  assert.equal(anchors.list().length, 1);
  assert.equal(outbox.metrics().COMPLETED, 1);
});

test("runs a queued trace refresh through the case reforecast handler", () => {
  const outbox = new InMemoryOutbox();
  const seen: string[] = [];
  outbox.enqueue({ type: "TRACE_REFRESH", idempotencyKey: "refresh-1", createdAt: "2026-08-24T10:00:00.000Z", payload: { transactionId: "T1001" } });
  const worker = new TraceRefreshWorker(outbox, { refreshTracesForTransaction(transactionId) { seen.push(transactionId); } });
  assert.equal(worker.processOne("2026-08-24T10:00:00.000Z"), "PROCESSED");
  assert.deepEqual(seen, ["T1001"]);
});

