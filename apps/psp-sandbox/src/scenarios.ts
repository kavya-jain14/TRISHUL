import type { ProviderOperationalEvent, ProviderResolveTransactionEvent } from "../../../packages/contracts/src/integrations.ts";
import type { TransactionEvent } from "../../../packages/ledger/src/schema.ts";

const providerId = "TRISHUL_DEMO_PSP";
const at = (time: string) => `2026-08-24T${time}.000Z`;

export type ProviderScenarioId = "A" | "B";
export type ProviderScenarioUpdate =
  | { kind: "TRANSFER"; event: TransactionEvent }
  | { kind: "OPERATIONAL"; event: ProviderOperationalEvent };

export type ProviderScenarioFixture = {
  id: ProviderScenarioId;
  label: string;
  expectedState: "PREDICT_AFTER_UPDATE" | "ABSTAIN_MONITORING";
  resolution: ProviderResolveTransactionEvent;
  initialTransfers: readonly TransactionEvent[];
  updates: readonly ProviderScenarioUpdate[];
};

function transfer(input: {
  eventId: string;
  transactionId: string;
  providerReference: string;
  time: string;
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  channel: "UPI" | "IMPS" | "NEFT";
}): TransactionEvent {
  const occurredAt = at(input.time);
  return {
    eventId: input.eventId,
    transactionId: input.transactionId,
    idempotencyKey: `provider:${input.providerReference}`,
    sequence: 0,
    occurredAt,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amountPaise: input.amountPaise,
    channel: input.channel,
    source: "SYNTHETIC_LEDGER",
    provenance: { providerId, providerReference: input.providerReference, recordedAt: occurredAt },
    intelligence: { complaintLinkCount: 0, sharedDeviceCount: 0, reportedMuleProximity: 0, priorCashOutCount: 0, geoCandidates: [] }
  };
}

const scenarioA: ProviderScenarioFixture = {
  id: "A",
  label: "Full trace, reforecast, intervention, and cash-out outcome",
  expectedState: "PREDICT_AFTER_UPDATE",
  resolution: {
    eventId: "provider-resolve-a", type: "RESOLVE_TRANSACTION", caseId: "case-golden-001",
    originalReference: "RRN-T1001", transactionId: "T1001", beneficiaryAccountId: "acct-a",
    amountPaise: 5_000_000, providerId, providerReference: "RRN-T1001", occurredAt: at("08:00:01"), source: "SYNTHETIC_LEDGER"
  },
  initialTransfers: [
    transfer({ eventId: "evt-t1001", transactionId: "T1001", providerReference: "RRN-T1001", time: "08:00:00", fromAccountId: "acct-kavya", toAccountId: "acct-a", amountPaise: 5_000_000, channel: "UPI" }),
    transfer({ eventId: "evt-t1002", transactionId: "T1002", providerReference: "RRN-T1002", time: "08:05:00", fromAccountId: "acct-a", toAccountId: "acct-b", amountPaise: 3_500_000, channel: "IMPS" }),
    transfer({ eventId: "evt-t1003", transactionId: "T1003", providerReference: "RRN-T1003", time: "08:06:00", fromAccountId: "acct-a", toAccountId: "acct-c", amountPaise: 1_500_000, channel: "NEFT" }),
    transfer({ eventId: "evt-t1004", transactionId: "T1004", providerReference: "RRN-T1004", time: "08:11:00", fromAccountId: "acct-b", toAccountId: "acct-d", amountPaise: 3_000_000, channel: "IMPS" })
  ],
  updates: [
    { kind: "TRANSFER", event: transfer({ eventId: "evt-t1005", transactionId: "T1005", providerReference: "RRN-T1005", time: "08:18:00", fromAccountId: "acct-d", toAccountId: "acct-e", amountPaise: 2_800_000, channel: "IMPS" }) },
    { kind: "OPERATIONAL", event: { eventId: "provider-status-e", type: "ACCOUNT_STATUS", accountId: "acct-e", status: "UNDER_REVIEW", reason: "High-risk downstream convergence", providerId, providerReference: "STATUS-ACCT-E-1", occurredAt: at("08:19:00"), source: "SYNTHETIC_LEDGER" } },
    { kind: "OPERATIONAL", event: { eventId: "provider-action-e", type: "RESTRICTION_ACTION", caseId: "case-golden-001", accountId: "acct-e", action: "ALERT_BANK", actorReference: "demo-investigator", reason: "Active intervention window", providerId, providerReference: "ACTION-ACCT-E-1", occurredAt: at("08:20:00"), source: "SYNTHETIC_LEDGER" } },
    { kind: "OPERATIONAL", event: { eventId: "provider-cashout-e", type: "CASH_OUT", caseId: "case-golden-001", transactionId: "T1006", accountId: "acct-e", amountPaise: 2_500_000, channel: "ATM_CASH_WITHDRAWAL", locationId: "geo-noida", endpointReference: "ATM-DEMO-NOIDA-01", providerId, providerReference: "RRN-T1006", occurredAt: at("08:27:00"), source: "SYNTHETIC_LEDGER" } },
    { kind: "OPERATIONAL", event: { eventId: "provider-outcome-a", type: "OUTCOME", caseId: "case-golden-001", actualExitMode: "CASH_OUT", accountId: "acct-e", locationId: "geo-noida", channel: "ATM_CASH_WITHDRAWAL", providerId, providerReference: "OUTCOME-CASE-A", occurredAt: at("08:28:00"), source: "SYNTHETIC_LEDGER" } }
  ]
};

const scenarioB: ProviderScenarioFixture = {
  id: "B",
  label: "Stationary funds with intentional geo/time abstention",
  expectedState: "ABSTAIN_MONITORING",
  resolution: {
    eventId: "provider-resolve-b", type: "RESOLVE_TRANSACTION", caseId: "case-stationary-001",
    originalReference: "RRN-X1001", transactionId: "X1001", beneficiaryAccountId: "acct-x",
    amountPaise: 1_500_000, providerId, providerReference: "RRN-X1001", occurredAt: at("09:00:01"), source: "SYNTHETIC_LEDGER"
  },
  initialTransfers: [
    transfer({ eventId: "evt-x1001", transactionId: "X1001", providerReference: "RRN-X1001", time: "09:00:00", fromAccountId: "acct-victim-x", toAccountId: "acct-x", amountPaise: 1_500_000, channel: "UPI" })
  ],
  updates: [
    { kind: "OPERATIONAL", event: { eventId: "provider-status-x", type: "ACCOUNT_STATUS", accountId: "acct-x", status: "ACTIVE", reason: "Funds stationary; monitoring for new authorised events", providerId, providerReference: "STATUS-ACCT-X-1", occurredAt: at("09:15:00"), source: "SYNTHETIC_LEDGER" } }
  ]
};

export const providerScenarios: Readonly<Record<ProviderScenarioId, ProviderScenarioFixture>> = { A: scenarioA, B: scenarioB };
