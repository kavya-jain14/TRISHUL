import type { EvidenceGateResult } from '@trishul/contracts';

export interface EvidenceGateInput {
  graphConfidence: number;
  dataCoverage: number;
  modelStability: number;
  accountCashOutHistoryCount: number;
  networkCashOutHistoryCount: number;
}

const RULE_VERSION = 'evidence-gate-v1' as const;

function assertProbability(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

export function evaluateEvidenceGate(input: EvidenceGateInput): EvidenceGateResult {
  assertProbability('graphConfidence', input.graphConfidence);
  assertProbability('dataCoverage', input.dataCoverage);
  assertProbability('modelStability', input.modelStability);
  assertCount('accountCashOutHistoryCount', input.accountCashOutHistoryCount);
  assertCount('networkCashOutHistoryCount', input.networkCashOutHistoryCount);

  const historyCount = input.accountCashOutHistoryCount + input.networkCashOutHistoryCount;
  const historySupport = Math.min(1, historyCount / 5);
  const coverageScore = Number(
    (
      input.graphConfidence * 0.35 +
      input.dataCoverage * 0.3 +
      input.modelStability * 0.2 +
      historySupport * 0.15
    ).toFixed(3),
  );

  const missingEvidence: string[] = [];
  if (input.graphConfidence < 0.65) missingEvidence.push('GRAPH_CONFIDENCE');
  if (input.dataCoverage < 0.7) missingEvidence.push('DATA_COVERAGE');
  if (input.modelStability < 0.6) missingEvidence.push('MODEL_STABILITY');
  if (historyCount < 3) missingEvidence.push('CASHOUT_HISTORY');

  const passed = missingEvidence.length === 0 && coverageScore >= 0.7;

  return {
    outcome: passed ? 'PASS' : 'ABSTAIN',
    coverageScore,
    reasonCodes: passed ? ['EVIDENCE_GATE_PASSED'] : ['INSUFFICIENT_EVIDENCE'],
    missingEvidence,
    ruleVersion: RULE_VERSION,
  };
}
