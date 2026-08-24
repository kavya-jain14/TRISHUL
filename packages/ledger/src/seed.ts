import { SyntheticLedger } from "./ledger.ts";

const at = (time: string) => `2026-08-24T${time}.000Z`;

export function createGoldenDemoLedger(): SyntheticLedger {
  const ledger = new SyntheticLedger();
  [
    {
      eventId: "evt-payment-a-b", transactionId: "txn-kavya-a-b", idempotencyKey: "seed:txn-kavya-a-b",
      sequence: 0, occurredAt: at("08:00:00"), fromAccountId: "acct-kavya", toAccountId: "acct-b",
      amountPaise: 5_000_000, channel: "UPI", source: "SYNTHETIC_LEDGER"
    },
    {
      eventId: "evt-forward-b-c", transactionId: "txn-b-c", idempotencyKey: "seed:txn-b-c",
      sequence: 0, occurredAt: at("08:08:00"), fromAccountId: "acct-b", toAccountId: "acct-c",
      amountPaise: 4_600_000, channel: "IMPS",
      intelligence: { complaintLinkCount: 1, sharedDeviceCount: 0, reportedMuleProximity: 1, priorCashOutCount: 0, geoCandidates: [] }, source: "SYNTHETIC_LEDGER"
    },
    {
      eventId: "evt-forward-c-d", transactionId: "txn-c-d", idempotencyKey: "seed:txn-c-d",
      sequence: 0, occurredAt: at("08:17:00"), fromAccountId: "acct-c", toAccountId: "acct-d",
      amountPaise: 4_300_000, channel: "NEFT",
      intelligence: {
        complaintLinkCount: 2, sharedDeviceCount: 1, reportedMuleProximity: 1, priorCashOutCount: 2,
        geoCandidates: [
          { locationId: "geo-ghaziabad", label: "Ghaziabad ATM cluster", latitude: 28.6692, longitude: 77.4538, historicalWeight: 52 },
          { locationId: "geo-noida", label: "Noida ATM cluster", latitude: 28.5355, longitude: 77.391, historicalWeight: 26 },
          { locationId: "geo-east-delhi", label: "East Delhi ATM cluster", latitude: 28.6304, longitude: 77.295, historicalWeight: 22 }
        ]
      }, source: "SYNTHETIC_LEDGER"
    },
    {
      eventId: "evt-stationary-x", transactionId: "txn-x", idempotencyKey: "seed:txn-x",
      sequence: 0, occurredAt: at("08:20:00"), fromAccountId: "acct-victim-x", toAccountId: "acct-x",
      amountPaise: 1_500_000, channel: "UPI", source: "SYNTHETIC_LEDGER"
    }
  ].forEach((event) => ledger.append(event));
  return ledger;
}

