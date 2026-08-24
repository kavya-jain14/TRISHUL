import assert from "node:assert/strict";
import test from "node:test";
import { SyntheticLedger } from "./ledger.ts";
import { createGoldenDemoLedger } from "./seed.ts";

const event = {
  eventId: "event-1", transactionId: "transaction-1", idempotencyKey: "request-1", sequence: 0,
  occurredAt: "2026-08-24T10:00:00.000Z", fromAccountId: "account-a", toAccountId: "account-b",
  amountPaise: 100, channel: "UPI" as const, source: "SYNTHETIC_LEDGER" as const
};

test("appends each event once and recognises a safe retry", () => {
  const ledger = new SyntheticLedger();
  assert.equal(ledger.append(event).status, "APPENDED");
  assert.equal(ledger.append(event).status, "IDEMPOTENT_REPLAY");
  assert.equal(ledger.resolve({ caseId: "case-1", transactionId: event.transactionId }).length, 1);
});

test("rejects an idempotency-key collision", () => {
  const ledger = new SyntheticLedger();
  ledger.append(event);
  assert.throws(() => ledger.append({ ...event, amountPaise: 101 }), /reused with a different event/);
});

test("keeps received events immutable and resolves them in event-time order", () => {
  const ledger = new SyntheticLedger();
  ledger.append({ ...event, eventId: "late", idempotencyKey: "late", sequence: 1, occurredAt: "2026-08-24T11:00:00.000Z" });
  ledger.append({ ...event, eventId: "early", idempotencyKey: "early", sequence: 0, occurredAt: "2026-08-24T09:00:00.000Z" });
  const resolved = ledger.resolve({ caseId: "case-1", transactionId: event.transactionId });
  assert.deepEqual(resolved.map((item) => item.eventId), ["early", "late"]);
  assert.throws(() => Object.assign(resolved[0]!, { amountPaise: 1 }), TypeError);
});

test("provides both golden-demo trace seed states", () => {
  const ledger = createGoldenDemoLedger();
  assert.equal(ledger.resolve({ caseId: "case-predict", transactionId: "txn-kavya-a-b" })[0]?.toAccountId, "acct-b");
  assert.equal(ledger.resolve({ caseId: "case-abstain", transactionId: "txn-x" })[0]?.toAccountId, "acct-x");
});

test("traces only later, connected fund movements through the configured hop limit", () => {
  const ledger = createGoldenDemoLedger();
  const trace = ledger.trace({ caseId: "case-predict", transactionId: "txn-kavya-a-b", maxHops: 2 });
  assert.deepEqual(trace.events.map((item) => item.eventId), ["evt-payment-a-b", "evt-forward-b-c", "evt-forward-c-d"]);
  assert.equal(trace.hopCount, 2);
  assert.deepEqual(trace.terminalAccountIds, ["acct-d"]);
});

test("does not follow transactions that occurred before the inbound payment", () => {
  const ledger = createGoldenDemoLedger();
  ledger.append({
    ...event, eventId: "old-account-b-transfer", transactionId: "txn-old", idempotencyKey: "old-account-b-transfer",
    occurredAt: "2026-08-24T07:59:00.000Z", fromAccountId: "acct-b", toAccountId: "acct-unrelated"
  });
  const trace = ledger.trace({ caseId: "case-predict", transactionId: "txn-kavya-a-b" });
  assert.equal(trace.events.some((item) => item.eventId === "old-account-b-transfer"), false);
});

