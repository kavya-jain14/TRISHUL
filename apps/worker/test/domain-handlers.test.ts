import { describe, expect, test, vi } from 'vitest';
import type { CaseOperations } from '../src/api-client.js';
import { createDomainHandlers } from '../src/domain-handlers.js';
import type { StructuredLogger } from '../src/logger.js';

function operations(): CaseOperations {
  return {
    trace: vi.fn(),
    recomputeExposure: vi.fn(),
    reassessRisk: vi.fn(),
    refreshForecast: vi.fn(),
    anchorEvidence: vi.fn(),
  };
}

describe('domain worker handlers', () => {
  test('registers every declared domain operation and validates trace jobs', async () => {
    const client = operations();
    const events: string[] = [];
    const logger: StructuredLogger = {
      log(_level, event) {
        events.push(event);
      },
    };
    const handlers = createDomainHandlers(client, logger);

    expect(Object.keys(handlers).sort()).toEqual([
      'EVIDENCE_ANCHOR',
      'EXPOSURE_RECOMPUTE',
      'FORECAST_REFRESH',
      'RISK_REASSESSMENT',
      'TRACE_GRAPH_EXPANSION',
    ]);
    await handlers.TRACE_GRAPH_EXPANSION!(
      { caseId: 'case-worker-a', idempotencyKey: 'trace-worker-a' },
      { signal: new AbortController().signal, heartbeat: async () => undefined },
    );

    expect(client.trace).toHaveBeenCalledWith({
      caseId: 'case-worker-a',
      idempotencyKey: 'trace-worker-a',
    });
    expect(events).toContain('trace_graph_expansion_dispatched');
    await expect(
      handlers.TRACE_GRAPH_EXPANSION!(
        { caseId: 'case-worker-a', idempotencyKey: 'trace-worker-a', unexpected: true },
        { signal: new AbortController().signal, heartbeat: async () => undefined },
      ),
    ).rejects.toThrow();
  });

  test('dispatches an evidence anchor without logging raw evidence', async () => {
    const client = operations();
    const logged: unknown[] = [];
    const logger: StructuredLogger = {
      log(_level, event, fields) {
        logged.push({ event, fields });
      },
    };
    const handler = createDomainHandlers(client, logger).EVIDENCE_ANCHOR!;
    const payload = {
      caseId: 'case-anchor-worker',
      idempotencyKey: 'anchor-worker-key',
      request: {
        evidenceRef: 'evidence-worker-1',
        evidence: { victimAccount: 'private-account-value' },
      },
    };

    await handler(payload, {
      signal: new AbortController().signal,
      heartbeat: async () => undefined,
    });

    expect(client.anchorEvidence).toHaveBeenCalledWith(payload);
    expect(JSON.stringify(logged)).not.toContain('private-account-value');
    expect(logged).toEqual([
      {
        event: 'evidence_anchor_dispatched',
        fields: {
          deliveryMode: 'CANONICAL_API',
          caseId: 'case-anchor-worker',
          evidenceRef: 'evidence-worker-1',
        },
      },
    ]);
  });
});
