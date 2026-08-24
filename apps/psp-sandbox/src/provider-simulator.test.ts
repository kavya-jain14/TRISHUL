import assert from "node:assert/strict";
import test from "node:test";
import { ProviderSandbox } from "./provider-simulator.ts";

test("resolves the deterministic provider RRN into a four-event trail with provenance", () => {
  const sandbox = new ProviderSandbox();
  sandbox.loadGoldenScenario();
  const trace = sandbox.resolveTransaction("T1001", "case-golden-001");
  assert.deepEqual(trace.events.map((event) => event.transactionId), ["T1001", "T1002", "T1003", "T1004"]);
  assert.deepEqual(trace.terminalAccountIds, ["acct-c", "acct-d"]);
  assert.ok(trace.events.every((event) => event.provenance.providerId === "TRISHUL_DEMO_PSP"));
  assert.ok(trace.events.every((event) => event.provenance.providerReference.startsWith("RRN-")));
});

