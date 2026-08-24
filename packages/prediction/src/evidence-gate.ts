import type {
  EvidenceDimensionDecision,
  EvidenceDimensionInput,
  ExitModeSnapshot,
} from '@trishul/contracts';

function assertProbability(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

export function evaluateEvidenceGate(
  input: EvidenceDimensionInput,
  exitMode: ExitModeSnapshot['selectedMode'],
): EvidenceDimensionDecision {
  assertProbability('sameAccountHistory', input.sameAccountHistory);
  assertProbability('connectedNetworkHistory', input.connectedNetworkHistory);
  assertProbability('graphConfidence', input.graphConfidence);
  assertProbability('historicalSupport', input.historicalSupport);
  assertProbability('predictionStability', input.predictionStability);

  const coverageScore = Number(
    (
      input.sameAccountHistory * 0.35 +
      input.connectedNetworkHistory * 0.3 +
      input.graphConfidence * 0.2 +
      input.historicalSupport * 0.15
    ).toFixed(3),
  );

  const missingEvidence: string[] = [];
  if (Math.max(input.sameAccountHistory, input.connectedNetworkHistory) < 0.6) {
    missingEvidence.push('CASHOUT_HISTORY');
  }
  if (input.graphConfidence < 0.65) missingEvidence.push('GRAPH_CONFIDENCE');
  if (input.historicalSupport < 0.5) missingEvidence.push('HISTORICAL_SUPPORT');
  if (input.predictionStability < 0.6) missingEvidence.push('PREDICTION_STABILITY');
  if (exitMode !== 'CASH_OUT_LIKELY') missingEvidence.push('EXIT_MODE_NOT_CASH_OUT');

  const coverageState =
    coverageScore >= 0.8 && input.predictionStability >= 0.75
      ? 'HIGH'
      : coverageScore >= 0.65 && input.predictionStability >= 0.6
        ? 'MEDIUM'
        : coverageScore >= 0.45
          ? 'LOW'
          : 'INSUFFICIENT';
  const passed =
    missingEvidence.length === 0 && (coverageState === 'HIGH' || coverageState === 'MEDIUM');

  return {
    decision: passed ? 'PASS' : 'ABSTAIN',
    coverageState,
    coverageScore,
    predictionStability: input.predictionStability,
    reasonCodes: passed
      ? [
          'EVIDENCE_GATE_PASSED',
          input.sameAccountHistory >= input.connectedNetworkHistory
            ? 'ACCOUNT_HISTORY_SUPPORT'
            : 'NETWORK_HISTORY_SUPPORT',
        ]
      : exitMode !== 'CASH_OUT_LIKELY'
        ? ['EXIT_MODE_WITHHELD_FORECAST']
        : ['INSUFFICIENT_EVIDENCE'],
    missingEvidence,
    formulaVersion: 'evidence-coverage-v1',
    provenance: input.provenance,
  };
}
