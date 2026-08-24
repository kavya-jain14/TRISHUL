import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCaseIntelligence, runGoldenTraceDemo } from '../src/lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Case Intelligence API client', () => {
  it('treats GRAPH_NOT_AVAILABLE as an intentional pending state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          case: {
            summary: {
              caseId: 'case:test',
              complaintId: 'test',
              state: 'ACTIVE',
              originalTransactionRef: 'T1',
              graphVersion: 0,
              createdAt: '2026-08-24T10:00:00.000Z',
              updatedAt: '2026-08-24T10:00:00.000Z',
            },
            complaint: {
              complaintId: 'test',
              originalTransactionRef: 'T1',
              reportedAmount: { amountMinor: 100, currency: 'INR' },
              transactionOccurredAt: '2026-08-24T09:50:00.000Z',
              reportedAt: '2026-08-24T10:00:00.000Z',
              category: 'TEST',
              source: 'VICTIM',
              evidenceReferences: [],
            },
            resolvedBeneficiaryAccount: 'acct-a',
            providerEventCount: 1,
            processedEventCount: 0,
            latestCoverageBoundary: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'GRAPH_NOT_AVAILABLE', message: 'Run TRACE before requesting the graph' },
          409,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadCaseIntelligence('case:test');

    expect(result.graph).toBeNull();
    expect(result.graphPending).toBe(true);
  });

  it('routes simulator events through backend resolution and ledger endpoints', async () => {
    const resolveEvent = {
      eventId: 'evt-resolve',
      caseId: 'case:complaint-golden-a',
      type: 'RESOLVE_TRANSACTION',
      occurredAt: '2026-08-24T10:15:00.000Z',
      provenance: {
        sourceType: 'SIMULATOR',
        sourceName: 'Sandbox',
        sourceEventId: 'evt-resolve',
        observedAt: '2026-08-24T10:15:00.000Z',
        evidenceState: 'SIMULATED',
      },
      originalRef: 'T1001',
      beneficiaryAccount: 'acct-a',
      provider: 'Demo Bank',
    };
    const transferEvent = {
      eventId: 'evt-transfer',
      caseId: 'case:complaint-golden-a',
      type: 'TRANSFER',
      occurredAt: '2026-08-24T10:00:00.000Z',
      provenance: {
        sourceType: 'SIMULATOR',
        sourceName: 'Sandbox',
        sourceEventId: 'evt-transfer',
        observedAt: '2026-08-24T10:15:01.000Z',
        evidenceState: 'SIMULATED',
      },
      transactionId: 'T1001',
      providerRef: 'RRN1001',
      fromAccount: 'acct-kavya',
      toAccount: 'acct-a',
      amount: { amountMinor: 5_000_000, currency: 'INR' },
    };
    const responses = [
      jsonResponse({ scenarioId: 'full-pipeline-reforecast', cursor: 0 }),
      jsonResponse({ case: {} }, 201),
      jsonResponse({
        scenarioId: 'full-pipeline-reforecast',
        cursor: 1,
        totalEvents: 2,
        done: false,
        event: resolveEvent,
      }),
      jsonResponse({ case: {} }),
      jsonResponse({
        scenarioId: 'full-pipeline-reforecast',
        cursor: 2,
        totalEvents: 2,
        done: true,
        event: transferEvent,
      }),
      jsonResponse({ acceptedEventIds: ['evt-transfer'] }),
      jsonResponse({ graphVersion: 1 }),
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal('fetch', fetchMock);

    const progress: string[] = [];
    const result = await runGoldenTraceDemo((message) => progress.push(message));
    const urls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(result).toBe('case:complaint-golden-a');
    expect(urls).toContain('/api/v1/cases/case%3Acomplaint-golden-a/resolve-transaction');
    expect(urls).toContain('/api/v1/cases/case%3Acomplaint-golden-a/provider-events');
    expect(urls.at(-1)).toBe('/api/v1/cases/case%3Acomplaint-golden-a/trace');
    expect(progress.at(-1)).toBe('Case Intelligence graph ready');
  });
});
