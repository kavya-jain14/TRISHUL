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

test("resolves a complaint RRN into the provider transaction and trace seed", () => {
  const sandbox = new ProviderSandbox();
  sandbox.loadScenario("A");
  const result = sandbox.resolveComplaint({ caseId: "case-golden-001", providerReference: "RRN-T1001" });
  assert.equal(result.resolution.type, "RESOLVE_TRANSACTION");
  assert.equal(result.resolution.beneficiaryAccountId, "acct-a");
  assert.equal(result.trace.events.length, 4);
  assert.equal(sandbox.state().operationalEvents.length, 1);

  sandbox.resolveComplaint({ caseId: "case-golden-001", providerReference: "RRN-T1001" });
  assert.equal(sandbox.state().operationalEvents.length, 1);
});

test("Scenario A stages a new hop and every remaining provider event type", () => {
  const sandbox = new ProviderSandbox();
  sandbox.loadScenario("A");
  sandbox.resolveComplaint({ caseId: "case-golden-001", providerReference: "RRN-T1001" });
  assert.equal(sandbox.state().pendingUpdateCount, 5);

  const update = sandbox.emitNext();
  assert.equal(update?.kind, "TRANSFER");
  const reforecastTrace = sandbox.resolveTransaction("T1001", "case-golden-001");
  assert.ok(reforecastTrace.events.some((event) => event.transactionId === "T1005"));
  assert.deepEqual(reforecastTrace.terminalAccountIds, ["acct-c", "acct-e"]);

  sandbox.emitAll();
  assert.deepEqual(
    sandbox.state().operationalEvents.map((event) => event.type),
    ["RESOLVE_TRANSACTION", "ACCOUNT_STATUS", "RESTRICTION_ACTION", "CASH_OUT", "OUTCOME"]
  );
  assert.equal(sandbox.state().pendingUpdateCount, 0);
});

test("Scenario B remains stationary and explicitly contains no cash-out event", () => {
  const sandbox = new ProviderSandbox();
  sandbox.loadScenario("B");
  const result = sandbox.resolveComplaint({ caseId: "case-stationary-001", providerReference: "RRN-X1001" });
  assert.equal(result.trace.events.length, 1);
  assert.deepEqual(result.trace.terminalAccountIds, ["acct-x"]);
  sandbox.emitAll();
  assert.deepEqual(sandbox.state().operationalEvents.map((event) => event.type), ["RESOLVE_TRANSACTION", "ACCOUNT_STATUS"]);
  assert.equal(sandbox.state().operationalEvents.some((event) => event.type === "CASH_OUT"), false);
});

test("reset clears all state and scenario reload is deterministic", () => {
  const sandbox = new ProviderSandbox();
  sandbox.loadScenario("A");
  sandbox.resolveComplaint({ caseId: "case-golden-001", providerReference: "RRN-T1001" });
  sandbox.emitAll();
  sandbox.reset();
  assert.deepEqual(sandbox.state(), { scenarioId: null, expectedState: null, transactionEvents: [], operationalEvents: [], pendingUpdateCount: 0 });

  const firstReload = sandbox.loadScenario("A");
  sandbox.emitAll();
  sandbox.reset();
  const secondReload = sandbox.loadScenario("A");
  assert.deepEqual(secondReload, firstReload);
});

test("rejects an unknown or case-mismatched provider reference", () => {
  const sandbox = new ProviderSandbox();
  sandbox.loadScenario("A");
  assert.throws(
    () => sandbox.resolveComplaint({ caseId: "case-other", providerReference: "RRN-T1001" }),
    /could not be resolved/
  );
});

