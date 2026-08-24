import { ProviderSandbox } from "./provider-simulator.ts";

const sandbox = new ProviderSandbox();

const scenarioABefore = sandbox.loadScenario("A");
const scenarioAResolution = sandbox.resolveComplaint({ caseId: "case-golden-001", providerReference: "RRN-T1001" });
const scenarioAUpdates = sandbox.emitAll();
const scenarioAAfter = sandbox.state();

sandbox.reset();
const scenarioB = sandbox.loadScenario("B");
const scenarioBResolution = sandbox.resolveComplaint({ caseId: "case-stationary-001", providerReference: "RRN-X1001" });
sandbox.emitAll();

console.log(JSON.stringify({
  scenarioA: {
    expectedState: scenarioABefore.expectedState,
    resolvedTransactionId: scenarioAResolution.resolution.transactionId,
    initialTraceEventIds: scenarioAResolution.trace.events.map((event) => event.eventId),
    emittedUpdateTypes: scenarioAUpdates.map((update) => update.kind === "TRANSFER" ? "TRANSFER" : update.event.type),
    finalTerminalAccounts: sandboxStateTerminalAccounts(scenarioAAfter.transactionEvents)
  },
  scenarioB: {
    expectedState: scenarioB.expectedState,
    resolvedTransactionId: scenarioBResolution.resolution.transactionId,
    terminalAccounts: scenarioBResolution.trace.terminalAccountIds,
    providerEventTypes: sandbox.state().operationalEvents.map((event) => event.type)
  }
}, null, 2));

function sandboxStateTerminalAccounts(events: readonly { fromAccountId: string; toAccountId: string }[]): readonly string[] {
  const forwardedFrom = new Set(events.map((event) => event.fromAccountId));
  return [...new Set(events.map((event) => event.toAccountId))].filter((account) => !forwardedFrom.has(account)).sort();
}
