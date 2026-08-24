import { describe, expect, it } from 'vitest';
import { evaluateEvidenceGate } from '../src/index.js';

describe('evaluateEvidenceGate', () => {
  it('passes a supported graph and history combination', () => {
    const result = evaluateEvidenceGate({
      graphConfidence: 0.88,
      dataCoverage: 0.91,
      modelStability: 0.82,
      accountCashOutHistoryCount: 3,
      networkCashOutHistoryCount: 4,
    });

    expect(result.outcome).toBe('PASS');
    expect(result.missingEvidence).toEqual([]);
  });

  it('abstains for a stationary case with no support', () => {
    const result = evaluateEvidenceGate({
      graphConfidence: 0.41,
      dataCoverage: 0.55,
      modelStability: 0.7,
      accountCashOutHistoryCount: 0,
      networkCashOutHistoryCount: 0,
    });

    expect(result.outcome).toBe('ABSTAIN');
    expect(result.missingEvidence).toEqual([
      'GRAPH_CONFIDENCE',
      'DATA_COVERAGE',
      'CASHOUT_HISTORY',
    ]);
  });
});
