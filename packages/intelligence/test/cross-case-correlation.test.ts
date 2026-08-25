import type { GraphSnapshot, HistoricalCaseEvidence } from '@trishul/contracts';
import { describe, expect, it } from 'vitest';
import { correlateCrossCaseNetworks } from '../src/cross-case-correlation.js';

const evaluatedAt = '2026-08-25T06:30:00.000Z';
const calculationInputHash = 'a'.repeat(64);
const provenance = {
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL Demo Bank',
  sourceEventId: 'evidence:network-memory',
  observedAt: evaluatedAt,
  evidenceState: 'SIMULATED',
} as const;

function graph(
  caseId: string,
  accounts: string[],
  edges: [string, string, string][],
): GraphSnapshot {
  return {
    caseId,
    graphVersion: 1,
    generatedAt: evaluatedAt,
    nodes: accounts.map((accountId) => ({
      nodeId: accountId,
      caseId,
      type: 'ACCOUNT',
      label: accountId,
      firstObservedAt: evaluatedAt,
    })),
    edges: edges.map(([type, fromNodeId, toNodeId], index) => ({
      edgeId: `edge:${caseId.replaceAll(':', '-')}:${index}`,
      caseId,
      fromNodeId,
      toNodeId,
      type: type as 'PAID_TO' | 'TRANSFERRED_TO',
      amount: { amountMinor: 100_000, currency: 'INR' },
      occurredAt: evaluatedAt,
      provenance: {
        ...provenance,
        sourceEventId: `evidence:${caseId.replaceAll(':', '-')}:${index}`,
      },
    })),
  };
}

function history(
  caseId: string,
  historicalGraph: GraphSnapshot,
  status: 'NO_INSTITUTIONAL_OUTCOME' | 'SUSPECTED' | 'CONFIRMED' | 'CLEARED',
): HistoricalCaseEvidence {
  return {
    caseId,
    graph: historicalGraph,
    outcome:
      status === 'NO_INSTITUTIONAL_OUTCOME'
        ? { status }
        : { status, provenance: { ...provenance, sourceEventId: `outcome:${caseId}` } },
  };
}

const context = {
  correlationRunId: 'correlation:test-v1',
  evaluatedAt,
  calculationInputHash,
};

describe('cross-case network correlation', () => {
  it('keeps a complaint-only direct reuse low and never treats it as confirmation', () => {
    const current = graph(
      'case:current',
      ['acct:victim-current', 'acct:target'],
      [['PAID_TO', 'acct:victim-current', 'acct:target']],
    );
    const unresolved = history(
      'case:unresolved-secret',
      graph(
        'case:unresolved-secret',
        ['acct:victim-history', 'acct:target'],
        [['PAID_TO', 'acct:victim-history', 'acct:target']],
      ),
      'NO_INSTITUTIONAL_OUTCOME',
    );

    const signal = correlateCrossCaseNetworks(current, [unresolved], context).accountSignals[0];

    expect(signal?.crossCaseLinkage).toBe(0.1575);
    expect(signal?.confirmedOutcomeCaseCount).toBe(0);
    expect(signal?.reasonCodes).toContain('UNRESOLVED_HISTORY_DISCOUNTED');
    expect(JSON.stringify(signal)).not.toContain('case:unresolved-secret');
  });

  it('raises explainable linkage for trusted repeated downstream convergence', () => {
    const current = graph(
      'case:current',
      ['acct:victim-current', 'acct:target', 'acct:shared', 'acct:exit'],
      [
        ['PAID_TO', 'acct:victim-current', 'acct:target'],
        ['TRANSFERRED_TO', 'acct:target', 'acct:shared'],
        ['TRANSFERRED_TO', 'acct:shared', 'acct:exit'],
      ],
    );
    const confirmed = history(
      'case:confirmed-secret',
      graph(
        'case:confirmed-secret',
        ['acct:victim-history', 'acct:target', 'acct:shared', 'acct:exit'],
        [
          ['PAID_TO', 'acct:victim-history', 'acct:target'],
          ['TRANSFERRED_TO', 'acct:target', 'acct:shared'],
          ['TRANSFERRED_TO', 'acct:shared', 'acct:exit'],
        ],
      ),
      'CONFIRMED',
    );

    const signal = correlateCrossCaseNetworks(current, [confirmed], context).accountSignals.find(
      (candidate) => candidate.accountId === 'acct:target',
    );

    expect(signal).toMatchObject({
      crossCaseLinkage: 1,
      confirmedOutcomeCaseCount: 1,
      sharedDownstreamAccountIds: ['acct:exit', 'acct:shared'],
    });
    expect(signal?.matches[0]).toMatchObject({
      directAccountReuse: true,
      sharedDownstreamAccountCount: 2,
      sharedEdgeCount: 2,
      outcomeStatus: 'CONFIRMED',
      evidenceWeight: 1,
    });
  });

  it('excludes cleared history, ignores the current case, and orders output deterministically', () => {
    const current = graph(
      'case:current',
      ['acct:victim-current', 'acct:z', 'acct:a'],
      [
        ['PAID_TO', 'acct:victim-current', 'acct:a'],
        ['TRANSFERRED_TO', 'acct:a', 'acct:z'],
      ],
    );
    const cleared = history(
      'case:cleared-secret',
      graph(
        'case:cleared-secret',
        ['acct:victim-history', 'acct:a', 'acct:z'],
        [
          ['PAID_TO', 'acct:victim-history', 'acct:a'],
          ['TRANSFERRED_TO', 'acct:a', 'acct:z'],
        ],
      ),
      'CLEARED',
    );
    const self = history('case:current', current, 'CONFIRMED');

    const first = correlateCrossCaseNetworks(current, [self, cleared], context);
    const second = correlateCrossCaseNetworks(current, [cleared, self], context);

    expect(first).toEqual(second);
    expect(first.accountSignals.map((signal) => signal.accountId)).toEqual(['acct:a', 'acct:z']);
    expect(first.accountSignals[0]).toMatchObject({
      crossCaseLinkage: 0,
      matchedCaseCount: 1,
      clearedOutcomeCaseCount: 1,
    });
    expect(first.accountSignals[0]?.reasonCodes).toContain('CLEARED_HISTORY_EXCLUDED');
    expect(JSON.stringify(first)).not.toContain('case:cleared-secret');
  });

  it('does not correlate repeated payer/victim accounts outside the reported network', () => {
    const current = graph(
      'case:current',
      ['acct:repeat-victim', 'acct:new-target'],
      [['PAID_TO', 'acct:repeat-victim', 'acct:new-target']],
    );
    const historyWithSameVictim = history(
      'case:history',
      graph(
        'case:history',
        ['acct:repeat-victim', 'acct:old-target'],
        [['PAID_TO', 'acct:repeat-victim', 'acct:old-target']],
      ),
      'CONFIRMED',
    );

    const result = correlateCrossCaseNetworks(current, [historyWithSameVictim], context);

    expect(result.accountSignals.map((signal) => signal.accountId)).toEqual(['acct:new-target']);
    expect(result.accountSignals[0]).toMatchObject({
      crossCaseLinkage: 0,
      matchedCaseCount: 0,
      reasonCodes: ['NO_CROSS_CASE_NETWORK_MATCH'],
    });
  });
});
