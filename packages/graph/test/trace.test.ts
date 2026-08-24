import { describe, expect, it } from 'vitest';
import { buildTraceGraph } from '../src/index.js';

const provenance = (eventId: string) => ({
  sourceType: 'SIMULATOR' as const,
  sourceName: 'TRISHUL PSP Sandbox',
  sourceEventId: eventId,
  observedAt: '2026-08-24T10:20:00.000Z',
  evidenceState: 'SIMULATED' as const,
});

const resolveEvent = {
  eventId: 'evt-resolve',
  caseId: 'case-a',
  type: 'RESOLVE_TRANSACTION' as const,
  occurredAt: '2026-08-24T10:15:00.000Z',
  provenance: provenance('evt-resolve'),
  originalRef: 'T1001',
  beneficiaryAccount: 'acct-a',
  provider: 'Demo Bank',
};

const laterTransfer = {
  eventId: 'evt-a-b',
  caseId: 'case-a',
  type: 'TRANSFER' as const,
  occurredAt: '2026-08-24T10:10:00.000Z',
  provenance: provenance('evt-a-b'),
  transactionId: 'T1002',
  providerRef: 'RRN1002',
  fromAccount: 'acct-a',
  toAccount: 'acct-b',
  amount: { amountMinor: 3_500_000, currency: 'INR' as const },
};

const originalTransfer = {
  eventId: 'evt-original',
  caseId: 'case-a',
  type: 'TRANSFER' as const,
  occurredAt: '2026-08-24T10:00:00.000Z',
  provenance: provenance('evt-original'),
  transactionId: 'T1001',
  providerRef: 'RRN1001',
  fromAccount: 'acct-kavya',
  toAccount: 'acct-a',
  amount: { amountMinor: 5_000_000, currency: 'INR' as const },
};

describe('buildTraceGraph', () => {
  it('orders out-of-order provider events by observed financial time', () => {
    const result = buildTraceGraph({
      caseId: 'case-a',
      originalTransactionRef: 'T1001',
      beneficiaryAccount: 'acct-a',
      events: [resolveEvent, laterTransfer, originalTransfer],
      currentGraph: null,
      nextGraphVersion: 1,
      generatedAt: '2026-08-24T10:21:00.000Z',
    });

    expect(result.graph.edges.map((edge) => edge.edgeId)).toEqual([
      'edge:evt-original',
      'edge:evt-a-b',
    ]);
    expect(result.graph.edges[0]?.type).toBe('PAID_TO');
    expect(result.graph.coverageBoundary).toContain('acct-b');
  });

  it('does not duplicate edges when the same events are replayed', () => {
    const first = buildTraceGraph({
      caseId: 'case-a',
      originalTransactionRef: 'T1001',
      beneficiaryAccount: 'acct-a',
      events: [resolveEvent, originalTransfer],
      currentGraph: null,
      nextGraphVersion: 1,
      generatedAt: '2026-08-24T10:21:00.000Z',
    });
    const replay = buildTraceGraph({
      caseId: 'case-a',
      originalTransactionRef: 'T1001',
      beneficiaryAccount: 'acct-a',
      events: [resolveEvent, originalTransfer],
      currentGraph: first.graph,
      nextGraphVersion: 2,
      generatedAt: '2026-08-24T10:22:00.000Z',
    });

    expect(replay.changed).toBe(false);
    expect(replay.graph.graphVersion).toBe(1);
    expect(replay.graph.edges).toHaveLength(1);
  });

  it('rejects a provider event without provenance before creating an edge', () => {
    expect(() =>
      buildTraceGraph({
        caseId: 'case-a',
        originalTransactionRef: 'T1001',
        beneficiaryAccount: 'acct-a',
        events: [{ ...originalTransfer, provenance: undefined }],
        currentGraph: null,
        nextGraphVersion: 1,
        generatedAt: '2026-08-24T10:21:00.000Z',
      }),
    ).toThrow();
  });
});
