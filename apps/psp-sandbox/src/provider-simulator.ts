import {
  complaintProviderResolutionRequestSchema,
  providerOperationalEventSchema,
  type ProviderOperationalEvent,
  type ProviderResolveTransactionEvent
} from "../../../packages/contracts/src/integrations.ts";
import { SyntheticLedger, type TraceResult } from "../../../packages/ledger/src/ledger.ts";
import type { TransactionEvent } from "../../../packages/ledger/src/schema.ts";
import { providerScenarios, type ProviderScenarioId, type ProviderScenarioUpdate } from "./scenarios.ts";

export type ComplaintResolution = {
  resolution: ProviderResolveTransactionEvent;
  trace: TraceResult;
};

export type ProviderSandboxState = {
  scenarioId: ProviderScenarioId | null;
  expectedState: "PREDICT_AFTER_UPDATE" | "ABSTAIN_MONITORING" | null;
  transactionEvents: readonly TransactionEvent[];
  operationalEvents: readonly ProviderOperationalEvent[];
  pendingUpdateCount: number;
};

export class ProviderSandbox {
  #ledger = new SyntheticLedger();
  readonly #resolutionsByReference = new Map<string, ProviderResolveTransactionEvent>();
  readonly #operationalByEventId = new Map<string, ProviderOperationalEvent>();
  #pendingUpdates: ProviderScenarioUpdate[] = [];
  #scenarioId: ProviderScenarioId | null = null;
  #expectedState: "PREDICT_AFTER_UPDATE" | "ABSTAIN_MONITORING" | null = null;

  loadGoldenScenario(): void {
    this.loadScenario("A");
  }

  loadScenario(scenarioId: ProviderScenarioId): ProviderSandboxState {
    this.reset();
    const scenario = providerScenarios[scenarioId];
    this.#scenarioId = scenarioId;
    this.#expectedState = scenario.expectedState;
    this.#resolutionsByReference.set(scenario.resolution.originalReference, scenario.resolution);
    for (const event of scenario.initialTransfers) this.#ledger.append(event);
    this.#pendingUpdates = [...scenario.updates];
    return this.state();
  }

  resolveComplaint(rawRequest: unknown): ComplaintResolution {
    const request = complaintProviderResolutionRequestSchema.parse(rawRequest);
    const fixture = this.#resolutionsByReference.get(request.providerReference);
    if (fixture === undefined || fixture.caseId !== request.caseId) {
      throw new Error(`Provider reference ${request.providerReference} could not be resolved for case ${request.caseId}.`);
    }
    const resolution = providerOperationalEventSchema.parse(fixture) as ProviderResolveTransactionEvent;
    this.#recordOperational(resolution);
    return {
      resolution,
      trace: this.#ledger.trace({ transactionId: resolution.transactionId, caseId: request.caseId, maxHops: 4 })
    };
  }

  resolveTransaction(transactionId: string, caseId: string): TraceResult {
    return this.#ledger.trace({ transactionId, caseId, maxHops: 4 });
  }

  emitNext(): ProviderScenarioUpdate | undefined {
    const update = this.#pendingUpdates.shift();
    if (update === undefined) return undefined;
    if (update.kind === "TRANSFER") this.#ledger.append(update.event);
    else this.#recordOperational(providerOperationalEventSchema.parse(update.event));
    return update;
  }

  emitAll(): readonly ProviderScenarioUpdate[] {
    const emitted: ProviderScenarioUpdate[] = [];
    let next = this.emitNext();
    while (next !== undefined) {
      emitted.push(next);
      next = this.emitNext();
    }
    return emitted;
  }

  reset(): void {
    this.#ledger = new SyntheticLedger();
    this.#resolutionsByReference.clear();
    this.#operationalByEventId.clear();
    this.#pendingUpdates = [];
    this.#scenarioId = null;
    this.#expectedState = null;
  }

  state(): ProviderSandboxState {
    return {
      scenarioId: this.#scenarioId,
      expectedState: this.#expectedState,
      transactionEvents: this.#ledger.allEvents(),
      operationalEvents: [...this.#operationalByEventId.values()],
      pendingUpdateCount: this.#pendingUpdates.length
    };
  }

  #recordOperational(event: ProviderOperationalEvent): void {
    const existing = this.#operationalByEventId.get(event.eventId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error(`Provider event ${event.eventId} was reused with different content.`);
    }
    this.#operationalByEventId.set(event.eventId, event);
  }
}
