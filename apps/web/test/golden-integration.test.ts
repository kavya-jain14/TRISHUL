import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../api/src/app.js';
import { buildSandboxApp } from '../../psp-sandbox/src/app.js';
import {
  loadCaseIntelligence,
  loadPredictionReadiness,
  runGoldenTraceDemo,
  runStationaryGateDemo,
} from '../src/lib/api.js';

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
      const readiness = await loadPredictionReadiness(caseId);

      expect(caseId).toBe('case:complaint-golden-a');
      expect(intelligence.caseDetail.summary.state).toBe('PREDICT');
      expect(intelligence.caseDetail.providerEventCount).toBe(6);
      expect(intelligence.caseDetail.processedEventCount).toBe(6);
      expect(intelligence.graphPending).toBe(false);
      expect(intelligence.graph?.graphVersion).toBe(1);
      expect(intelligence.graph?.edges).toHaveLength(5);
      expect(intelligence.graph?.edges.every((edge) => edge.provenance.sourceEventId)).toBe(true);
      expect(intelligence.graph?.coverageBoundary).toContain('Last observed at acct-e');
      expect(intelligence.exposure?.graphVersion).toBe(1);
      expect(intelligence.exposure?.states).toHaveLength(5);
      expect(intelligence.riskAssessments).toHaveLength(2);
      expect(
        intelligence.riskAssessments.every((assessment) => assessment.state !== 'CONFIRMED'),
      ).toBe(true);
      expect(readiness.exitMode?.selectedMode).toBe('CASH_OUT_LIKELY');
      expect(readiness.exitMode?.features).not.toHaveProperty('observedCashOut');
      expect(readiness.evidenceGate).toMatchObject({
        overallDecision: 'PREDICT',
        geo: { decision: 'PASS', coverageState: 'HIGH' },
        time: { decision: 'PASS', coverageState: 'HIGH' },
      });
      expect(readiness.evidenceGate?.geo).not.toHaveProperty('candidates');
      expect(readiness.evidenceGate?.time).not.toHaveProperty('horizons');
      expect(readiness.forecast?.geo).toMatchObject({ decision: 'PREDICT' });
      expect(readiness.forecast?.time).toMatchObject({
        decision: 'PREDICT',
        highestRiskBucket: '1_TO_2_HOURS',
      });
      expect(
        readiness.forecast?.geo.decision === 'PREDICT'
          ? readiness.forecast.geo.candidates[0]?.zoneId
          : null,
      ).toBe('zone-noida-sector-62');
      expect(progress.at(-1)).toBe('Evidence-gated zone and time forecast ready');
    } finally {
      await Promise.all([api.close(), sandbox.close()]);
    }
  });

  it('keeps stationary funds in intentional abstention through the real client flow', async () => {
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
      const caseId = await runStationaryGateDemo((message) => progress.push(message));
      const readiness = await loadPredictionReadiness(caseId);

      expect(caseId).toBe('case:complaint-golden-b');
      expect(readiness.caseDetail.summary.state).toBe('ABSTAIN');
      expect(readiness.exitMode?.selectedMode).toBe('STATIONARY');
      expect(readiness.evidenceGate?.overallDecision).toBe('ABSTAIN');
      expect(readiness.evidenceGate?.geo.decision).toBe('ABSTAIN');
      expect(readiness.evidenceGate?.time.decision).toBe('ABSTAIN');
      expect(readiness.evidenceGate?.geo.missingEvidence).toContain('EXIT_MODE_NOT_CASH_OUT');
      expect(readiness.forecast).toMatchObject({
        confidence: 0,
        geo: { decision: 'ABSTAIN' },
        time: { decision: 'ABSTAIN' },
      });
      expect(progress.at(-1)).toBe('Stationary funds retained; explicit forecast abstention ready');
    } finally {
      await Promise.all([api.close(), sandbox.close()]);
    }
  });
});
