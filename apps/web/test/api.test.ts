import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCaseIntelligence,
  loadPredictionReadiness,
  runGoldenTraceDemo,
} from '../src/lib/api.js';

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
    expect(result.exposure).toBeNull();
    expect(result.exposurePending).toBe(true);
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
      jsonResponse({ exposure: {} }),
      jsonResponse({ assessment: {} }),
      jsonResponse({ assessment: {} }),
      jsonResponse({ exitMode: {} }),
      jsonResponse({ evidenceGate: {} }),
      jsonResponse({ forecast: {} }),
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal('fetch', fetchMock);

    const progress: string[] = [];
    const result = await runGoldenTraceDemo((message) => progress.push(message));
    const urls = fetchMock.mock.calls.map(([url]) => String(url));

    expect(result).toBe('case:complaint-golden-a');
    expect(urls).toContain('/api/v1/cases/case%3Acomplaint-golden-a/resolve-transaction');
    expect(urls).toContain('/api/v1/cases/case%3Acomplaint-golden-a/provider-events');
    expect(urls).toContain('/api/v1/cases/case%3Acomplaint-golden-a/trace');
    expect(urls).toContain('/api/v1/cases/case%3Acomplaint-golden-a/recompute-exposure');
    expect(urls).toContain('/api/v1/accounts/acct-receiver-a/risk');
    expect(urls).toContain('/api/v1/accounts/acct-e/risk');
    expect(urls).toContain('/api/v1/cases/case%3Acomplaint-golden-a/exit-mode');
    expect(urls.at(-1)).toBe('/api/v1/cases/case%3Acomplaint-golden-a/predictions');
    expect(progress.at(-1)).toBe('Evidence-gated zone and time forecast ready');
  });

  it('treats missing exit-mode and gate snapshots as intentional pending states', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          case: {
            summary: {
              caseId: 'case:pending',
              complaintId: 'pending',
              state: 'RISK_ASSESSED',
              originalTransactionRef: 'T-PENDING',
              graphVersion: 1,
              createdAt: '2026-08-24T10:00:00.000Z',
              updatedAt: '2026-08-24T10:00:00.000Z',
            },
            complaint: {
              complaintId: 'pending',
              originalTransactionRef: 'T-PENDING',
              reportedAmount: { amountMinor: 100, currency: 'INR' },
              transactionOccurredAt: '2026-08-24T09:50:00.000Z',
              reportedAt: '2026-08-24T10:00:00.000Z',
              category: 'TEST',
              source: 'VICTIM',
              evidenceReferences: [],
            },
            resolvedBeneficiaryAccount: 'acct-a',
            providerEventCount: 1,
            processedEventCount: 1,
            latestCoverageBoundary: 'Provider visibility ended',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'EXIT_MODE_NOT_AVAILABLE', message: 'Exit mode is pending' }, 409),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'EVIDENCE_GATE_NOT_AVAILABLE', message: 'Evidence Gate is pending' },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'FORECAST_NOT_AVAILABLE', message: 'Forecast is pending' }, 409),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadPredictionReadiness('case:pending');

    expect(result.exitMode).toBeNull();
    expect(result.exitModePending).toBe(true);
    expect(result.evidenceGate).toBeNull();
    expect(result.evidenceGatePending).toBe(true);
    expect(result.forecast).toBeNull();
    expect(result.forecastPending).toBe(true);
  });
});
