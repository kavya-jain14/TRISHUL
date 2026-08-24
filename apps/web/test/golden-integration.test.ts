import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../api/src/app.js';
import { buildSandboxApp } from '../../psp-sandbox/src/app.js';
import { loadCaseIntelligence, runGoldenTraceDemo } from '../src/lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('golden complaint-to-trace integration', () => {
  it('runs the browser client against real API and PSP sandbox instances', async () => {
    const api = buildApp();
    const sandbox = buildSandboxApp();

    const fetchBridge = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = String(input);
      const useSandbox = rawUrl.startsWith('/sandbox');
      const target = useSandbox ? sandbox : api;
      const url = useSandbox ? rawUrl.replace(/^\/sandbox/, '/api/v1') : rawUrl;
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const response = await target.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url,
        headers,
        payload: typeof init?.body === 'string' ? init.body : undefined,
      });

      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': response.headers['content-type'] ?? 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchBridge);

    try {
      const progress: string[] = [];
      const caseId = await runGoldenTraceDemo((message) => progress.push(message));
      const intelligence = await loadCaseIntelligence(caseId);

      expect(caseId).toBe('case:complaint-golden-a');
      expect(intelligence.caseDetail.summary.state).toBe('RISK_ASSESSED');
      expect(intelligence.caseDetail.providerEventCount).toBe(8);
      expect(intelligence.caseDetail.processedEventCount).toBe(8);
      expect(intelligence.graphPending).toBe(false);
      expect(intelligence.graph?.graphVersion).toBe(1);
      expect(intelligence.graph?.edges).toHaveLength(6);
      expect(intelligence.graph?.edges.every((edge) => edge.provenance.sourceEventId)).toBe(true);
      expect(intelligence.graph?.coverageBoundary).toContain('cash-out');
      expect(intelligence.exposure?.graphVersion).toBe(1);
      expect(intelligence.exposure?.states).toHaveLength(5);
      expect(intelligence.riskAssessments).toHaveLength(1);
      expect(intelligence.riskAssessments[0]?.state).not.toBe('CONFIRMED');
      expect(progress.at(-1)).toBe('Exposure and risk intelligence ready');
    } finally {
      await Promise.all([api.close(), sandbox.close()]);
    }
  });
});
