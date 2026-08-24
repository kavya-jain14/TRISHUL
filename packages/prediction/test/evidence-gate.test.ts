import { describe, expect, it } from 'vitest';
import { evaluateEvidenceGate } from '../src/index.js';

const provenance = {
  sourceType: 'SIMULATOR' as const,
  sourceName: 'TRISHUL Prediction Lab',
  sourceEventId: 'gate-evidence-v1',
  observedAt: '2026-08-24T12:00:00.000Z',
  evidenceState: 'SIMULATED' as const,
};

describe('evaluateEvidenceGate', () => {
  it('passes a supported cash-out-likely dimension using the blueprint formula', () => {
    const result = evaluateEvidenceGate(
      {
        sameAccountHistory: 0.9,
        connectedNetworkHistory: 0.8,
        graphConfidence: 0.9,
        historicalSupport: 0.8,
        predictionStability: 0.82,
        provenance,
      },
      'CASH_OUT_LIKELY',
    );

    expect(result.decision).toBe('PASS');
    expect(result.coverageState).toBe('HIGH');
    expect(result.coverageScore).toBe(0.855);
    expect(result.missingEvidence).toEqual([]);
  });

  it('abstains for a stationary case even when historical coverage is high', () => {
    const result = evaluateEvidenceGate(
      {
        sameAccountHistory: 0.9,
        connectedNetworkHistory: 0.8,
        graphConfidence: 0.9,
        historicalSupport: 0.8,
        predictionStability: 0.82,
        provenance,
      },
      'STATIONARY',
    );

    expect(result.decision).toBe('ABSTAIN');
    expect(result.missingEvidence).toEqual(['EXIT_MODE_NOT_CASH_OUT']);
    expect(result.reasonCodes).toEqual(['EXIT_MODE_WITHHELD_FORECAST']);
  });

  it('shows exactly which support is missing instead of forcing a prediction', () => {
    const result = evaluateEvidenceGate(
      {
        sameAccountHistory: 0.1,
        connectedNetworkHistory: 0.2,
        graphConfidence: 0.41,
        historicalSupport: 0.25,
        predictionStability: 0.7,
        provenance,
      },
      'CASH_OUT_LIKELY',
    );

    expect(result.decision).toBe('ABSTAIN');
    expect(result.coverageState).toBe('INSUFFICIENT');
    expect(result.missingEvidence).toEqual([
      'CASHOUT_HISTORY',
      'GRAPH_CONFIDENCE',
      'HISTORICAL_SUPPORT',
    ]);
  });
});
