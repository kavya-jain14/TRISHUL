import { SyntheticLedger, type TraceResult } from "../../../packages/ledger/src/ledger.ts";

const at = (time: string) => `2026-08-24T${time}.000Z`;
const providerId = "TRISHUL_DEMO_PSP";

export class ProviderSandbox {
  readonly #ledger = new SyntheticLedger();

  loadGoldenScenario(): void {
    [
      event("evt-t1001", "T1001", "RRN-T1001", "08:00:00", "acct-kavya", "acct-a", 5_000_000, "UPI"),
      event("evt-t1002", "T1002", "RRN-T1002", "08:05:00", "acct-a", "acct-b", 3_500_000, "IMPS"),
      event("evt-t1003", "T1003", "RRN-T1003", "08:06:00", "acct-a", "acct-c", 1_500_000, "NEFT"),
      event("evt-t1004", "T1004", "RRN-T1004", "08:11:00", "acct-b", "acct-d", 3_000_000, "IMPS")
    ].forEach((entry) => this.#ledger.append(entry));
  }

  resolveTransaction(transactionId: string, caseId: string): TraceResult {
    return this.#ledger.trace({ transactionId, caseId, maxHops: 4 });
  }
}

function event(eventId: string, transactionId: string, providerReference: string, time: string, fromAccountId: string, toAccountId: string, amountPaise: number, channel: "UPI" | "IMPS" | "NEFT") {
  const occurredAt = at(time);
  return {
    eventId, transactionId, idempotencyKey: `provider:${providerReference}`, sequence: 0, occurredAt,
    fromAccountId, toAccountId, amountPaise, channel, source: "SYNTHETIC_LEDGER" as const,
    provenance: { providerId, providerReference, recordedAt: occurredAt }
  };
}

