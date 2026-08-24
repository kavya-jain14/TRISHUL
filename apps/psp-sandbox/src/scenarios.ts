import { ProviderEventSchema, type ProviderEvent } from '@trishul/contracts';

export interface SandboxScenario {
  id: string;
  name: string;
  description: string;
  expectedOutcome: 'PREDICT_AND_REFORECAST' | 'ABSTAIN_AND_MONITOR';
  events: ProviderEvent[];
}

function simulatedProvenance(eventId: string, observedAt: string) {
  return {
    sourceType: 'SIMULATOR' as const,
    sourceName: 'TRISHUL PSP Sandbox',
    sourceEventId: eventId,
    observedAt,
    evidenceState: 'SIMULATED' as const,
  };
}

function validatedScenario(scenario: SandboxScenario): SandboxScenario {
  return {
    ...scenario,
    events: scenario.events.map((event) => ProviderEventSchema.parse(event)),
  };
}

export const SANDBOX_SCENARIOS: readonly SandboxScenario[] = [
  validatedScenario({
    id: 'full-pipeline-reforecast',
    name: 'Full pipeline with reforecast',
    description:
      'Kavya payment T1001 resolves into a multi-hop graph and later changes after a new downstream hop.',
    expectedOutcome: 'PREDICT_AND_REFORECAST',
    events: [
      {
        eventId: 'evt-a-001-resolve',
        caseId: 'case:complaint-golden-a',
        type: 'RESOLVE_TRANSACTION',
        occurredAt: '2026-08-24T10:15:00.000Z',
        provenance: simulatedProvenance('evt-a-001-resolve', '2026-08-24T10:15:00.000Z'),
        originalRef: 'T1001',
        beneficiaryAccount: 'acct-receiver-a',
        provider: 'TRISHUL Demo Bank',
      },
      {
        eventId: 'evt-a-002-payment',
        caseId: 'case:complaint-golden-a',
        type: 'TRANSFER',
        occurredAt: '2026-08-24T10:00:00.000Z',
        provenance: simulatedProvenance('evt-a-002-payment', '2026-08-24T10:15:01.000Z'),
        transactionId: 'T1001',
        providerRef: 'RRN1001',
        fromAccount: 'acct-kavya',
        toAccount: 'acct-receiver-a',
        amount: { amountMinor: 5_000_000, currency: 'INR' },
      },
      {
        eventId: 'evt-a-003-a-to-b',
        caseId: 'case:complaint-golden-a',
        type: 'TRANSFER',
        occurredAt: '2026-08-24T10:07:00.000Z',
        provenance: simulatedProvenance('evt-a-003-a-to-b', '2026-08-24T10:15:02.000Z'),
        transactionId: 'T1002',
        providerRef: 'RRN1002',
        fromAccount: 'acct-receiver-a',
        toAccount: 'acct-b',
        amount: { amountMinor: 3_500_000, currency: 'INR' },
      },
      {
        eventId: 'evt-a-004-a-to-c',
        caseId: 'case:complaint-golden-a',
        type: 'TRANSFER',
        occurredAt: '2026-08-24T10:08:00.000Z',
        provenance: simulatedProvenance('evt-a-004-a-to-c', '2026-08-24T10:15:03.000Z'),
        transactionId: 'T1003',
        providerRef: 'RRN1003',
        fromAccount: 'acct-receiver-a',
        toAccount: 'acct-c',
        amount: { amountMinor: 1_500_000, currency: 'INR' },
      },
      {
        eventId: 'evt-a-005-b-to-d',
        caseId: 'case:complaint-golden-a',
        type: 'TRANSFER',
        occurredAt: '2026-08-24T10:13:00.000Z',
        provenance: simulatedProvenance('evt-a-005-b-to-d', '2026-08-24T10:15:04.000Z'),
        transactionId: 'T1004',
        providerRef: 'RRN1004',
        fromAccount: 'acct-b',
        toAccount: 'acct-d',
        amount: { amountMinor: 3_000_000, currency: 'INR' },
      },
      {
        eventId: 'evt-a-006-d-to-e',
        caseId: 'case:complaint-golden-a',
        type: 'TRANSFER',
        occurredAt: '2026-08-24T10:26:00.000Z',
        provenance: simulatedProvenance('evt-a-006-d-to-e', '2026-08-24T10:26:01.000Z'),
        transactionId: 'T1005',
        providerRef: 'RRN1005',
        fromAccount: 'acct-d',
        toAccount: 'acct-e',
        amount: { amountMinor: 2_800_000, currency: 'INR' },
      },
      {
        eventId: 'evt-a-007-cashout',
        caseId: 'case:complaint-golden-a',
        type: 'CASH_OUT',
        occurredAt: '2026-08-24T11:18:00.000Z',
        provenance: simulatedProvenance('evt-a-007-cashout', '2026-08-24T11:18:01.000Z'),
        account: 'acct-e',
        amount: { amountMinor: 2_600_000, currency: 'INR' },
        channel: 'ATM',
        zone: 'noida-sector-62',
        endpointReference: 'atm-demo-62-04',
      },
      {
        eventId: 'evt-a-008-outcome',
        caseId: 'case:complaint-golden-a',
        type: 'OUTCOME',
        occurredAt: '2026-08-24T11:30:00.000Z',
        provenance: simulatedProvenance('evt-a-008-outcome', '2026-08-24T11:30:01.000Z'),
        actualExitMode: 'CASH_OUT',
        zone: 'noida-sector-62',
        cashOutAt: '2026-08-24T11:18:00.000Z',
        institutionalOutcome: 'CONFIRMED',
      },
    ],
  }),
  validatedScenario({
    id: 'stationary-abstention',
    name: 'Stationary funds and correct abstention',
    description:
      'T2001 resolves to account X with no downstream movement or reliable cash-out history.',
    expectedOutcome: 'ABSTAIN_AND_MONITOR',
    events: [
      {
        eventId: 'evt-b-001-resolve',
        caseId: 'case:complaint-golden-b',
        type: 'RESOLVE_TRANSACTION',
        occurredAt: '2026-08-24T11:15:00.000Z',
        provenance: simulatedProvenance('evt-b-001-resolve', '2026-08-24T11:15:00.000Z'),
        originalRef: 'T2001',
        beneficiaryAccount: 'acct-x',
        provider: 'TRISHUL Demo Bank',
      },
      {
        eventId: 'evt-b-002-payment',
        caseId: 'case:complaint-golden-b',
        type: 'TRANSFER',
        occurredAt: '2026-08-24T11:00:00.000Z',
        provenance: simulatedProvenance('evt-b-002-payment', '2026-08-24T11:15:01.000Z'),
        transactionId: 'T2001',
        providerRef: 'RRN2001',
        fromAccount: 'acct-victim-b',
        toAccount: 'acct-x',
        amount: { amountMinor: 1_800_000, currency: 'INR' },
      },
    ],
  }),
] as const;
