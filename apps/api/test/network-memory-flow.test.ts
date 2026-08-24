import { InMemoryNetworkMemoryRepository } from '@trishul/database';
import type { HistoricalCaseEvidence } from '@trishul/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
const caseId = 'case:network-memory-current';
const observedAt = '2026-08-25T06:30:00.000Z';
const provenance = (eventId: string) => ({
  sourceType: 'SIMULATOR' as const,
  sourceName: 'TRISHUL Demo Bank',
  sourceEventId: eventId,
  observedAt,
  evidenceState: 'SIMULATED' as const,
});

const historicalCase: HistoricalCaseEvidence = {
  caseId: 'case:historical-private-id',
  graph: {
    caseId: 'case:historical-private-id',
    graphVersion: 2,
    generatedAt: observedAt,
    nodes: ['acct:historical-victim', 'acct:root', 'acct:shared'].map((nodeId) => ({
      nodeId,
      caseId: 'case:historical-private-id',
      type: 'ACCOUNT',
      label: nodeId,
      firstObservedAt: observedAt,
    })),
    edges: [
      {
        edgeId: 'edge:historical-payment',
        caseId: 'case:historical-private-id',
        fromNodeId: 'acct:historical-victim',
        toNodeId: 'acct:root',
        type: 'PAID_TO',
        amount: { amountMinor: 500_000, currency: 'INR' },
        occurredAt: observedAt,
        provenance: provenance('event:historical-payment'),
      },
      {
        edgeId: 'edge:historical-root-shared',
        caseId: 'case:historical-private-id',
        fromNodeId: 'acct:root',
        toNodeId: 'acct:shared',
        type: 'TRANSFERRED_TO',
        amount: { amountMinor: 300_000, currency: 'INR' },
        occurredAt: observedAt,
        provenance: provenance('event:historical-transfer'),
      },
    ],
  },
  outcome: {
    status: 'CONFIRMED',
    provenance: provenance('event:historical-outcome'),
  },
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function prepareCurrentCase(app: ReturnType<typeof buildApp>) {
  await app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': 'network-complaint' },
    payload: {
      complaintId: 'network-memory-current',
      originalTransactionRef: 'txn:network-original',
      reportedAmount: { amountMinor: 500_000, currency: 'INR' },
      transactionOccurredAt: observedAt,
      reportedAt: observedAt,
      category: 'IMPERSONATION',
      source: 'VICTIM',
      evidenceReferences: [],
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/resolve-transaction`,
    headers: { 'idempotency-key': 'network-resolve' },
    payload: {
      eventId: 'event:network-resolve',
      caseId,
      type: 'RESOLVE_TRANSACTION',
      occurredAt: observedAt,
      provenance: provenance('event:network-resolve'),
      originalRef: 'txn:network-original',
      beneficiaryAccount: 'acct:root',
      provider: 'TRISHUL Demo Bank',
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/provider-events`,
    headers: { 'idempotency-key': 'network-events' },
    payload: {
      events: [
        {
          eventId: 'event:network-original',
          caseId,
          type: 'TRANSFER',
          occurredAt: observedAt,
          provenance: provenance('event:network-original'),
          transactionId: 'txn:network-original',
          providerRef: 'provider:network-original',
          fromAccount: 'acct:victim',
          toAccount: 'acct:root',
          amount: { amountMinor: 500_000, currency: 'INR' },
        },
        {
          eventId: 'event:network-forward',
          caseId,
          type: 'TRANSFER',
          occurredAt: '2026-08-25T06:35:00.000Z',
          provenance: provenance('event:network-forward'),
          transactionId: 'txn:network-forward',
          providerRef: 'provider:network-forward',
          fromAccount: 'acct:root',
          toAccount: 'acct:shared',
          amount: { amountMinor: 300_000, currency: 'INR' },
        },
      ],
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/trace`,
    headers: { 'idempotency-key': 'network-trace' },
  });
}

describe('cross-case network-memory API', () => {
  it('persists opaque idempotent correlation and feeds it into Mule Risk', async () => {
    const networkMemoryRepository = new InMemoryNetworkMemoryRepository([historicalCase]);
    const app = buildApp({ networkMemoryRepository });
    apps.push(app);
    await prepareCurrentCase(app);

    const missingKey = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/network-correlation`,
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/network-correlation`,
      headers: { 'idempotency-key': 'network-correlation-v1' },
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/network-correlation`,
      headers: { 'idempotency-key': 'network-correlation-v1' },
    });
    const latest = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/network-correlation/latest`,
    });

    expect(missingKey.statusCode).toBe(400);
    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ ...created.json(), replayed: true });
    expect(latest.json().correlation).toEqual(created.json().correlation);
    expect(created.json().correlation.accountSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'acct:root', crossCaseLinkage: 0.725 }),
      ]),
    );
    expect(created.body).not.toContain('case:historical-private-id');

    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'network-exposure-v1' },
      payload: {
        accountBalances: [
          {
            accountId: 'acct:root',
            knownCleanBalanceMinor: 100_000,
            provenance: provenance('balance:root'),
          },
          {
            accountId: 'acct:shared',
            knownCleanBalanceMinor: 0,
            provenance: provenance('balance:shared'),
          },
        ],
      },
    });
    const risk = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/acct:root/risk',
      headers: { 'idempotency-key': 'network-risk-v1' },
      payload: {
        caseId,
        providerSignals: {
          inflowSpike: 0,
          uniqueSenderSpike: 0,
          firstTimeSenderRatio: 0,
          behaviourShift: 0,
          crossCaseLinkage: 0,
          authorisedSharedIdentifierStrength: 0,
          provenance: provenance('risk:provider-signals'),
        },
        trustedOutcome: { status: 'NONE' },
      },
    });

    expect(risk.statusCode).toBe(200);
    expect(risk.json().assessment.features.network.crossCaseLinkage).toBe(0.725);
    expect(risk.json().assessment.crossCaseCorrelationRunId).toBe(
      created.json().correlation.correlationRunId,
    );
  });

  it('rejects idempotency drift when historical evidence changes', async () => {
    const networkMemoryRepository = new InMemoryNetworkMemoryRepository([historicalCase]);
    const app = buildApp({ networkMemoryRepository });
    apps.push(app);
    await prepareCurrentCase(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/network-correlation`,
      headers: { 'idempotency-key': 'network-drift' },
    });
    networkMemoryRepository.replaceHistoricalCases([
      { ...historicalCase, outcome: { status: 'NO_INSTITUTIONAL_OUTCOME' } },
    ]);

    const conflict = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/network-correlation`,
      headers: { 'idempotency-key': 'network-drift' },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('NETWORK_MEMORY_IDEMPOTENCY_CONFLICT');
  });
});
