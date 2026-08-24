import {
  CasePriorityDecisionSchema,
  CasePriorityFeaturesSchema,
  type CasePriorityBand,
  type CasePriorityDecision,
  type CasePriorityFeatures,
  type OperationalState,
  type RecommendedAction,
} from '@trishul/contracts';

const URGENT_BUCKETS = new Set(['UNDER_30_MIN', '30_TO_60_MIN', '1_TO_2_HOURS']);

/**
 * Deterministic operational triage. This score is not a guilt, intent, or identity judgement.
 * Complaint age is retained for explanation but deliberately excluded from the numeric score.
 */
export function evaluateCasePriority(rawFeatures: CasePriorityFeatures): CasePriorityDecision {
  const features = CasePriorityFeaturesSchema.parse(rawFeatures);
  const operationalState = operationalStateFor(features);
  let score = baseScore(features);

  if (operationalState === 'ACTIVE_INTERVENTION_WINDOW') score = Math.max(score, 65);
  if (operationalState === 'CASH_OUT_MAY_HAVE_OCCURRED') score = Math.max(score, 75);
  if (features.institutionalOutcome === 'CLEARED') score = 0;
  if (features.institutionalOutcome === 'CONFIRMED') score = Math.min(score, 30);

  const priorityScore = clamp(Math.round(score), 0, 100);
  const priorityBand = bandFor(priorityScore);
  const reasonCodes = reasonsFor(features, operationalState);
  const recommendedActions = actionsFor(operationalState, priorityBand, features);

  return CasePriorityDecisionSchema.parse({
    priorityScore,
    priorityBand,
    operationalState,
    reasonCodes,
    recommendedActions,
  });
}

function baseScore(features: CasePriorityFeatures): number {
  const exposureRatio =
    features.reportedAmountMinor === 0
      ? Number(features.maximumAttributableMinor > 0)
      : Math.min(features.maximumAttributableMinor / features.reportedAmountMinor, 1);
  const exitScore =
    features.exitMode === 'CASH_OUT_LIKELY' ? 15 : features.exitMode === 'FORWARD' ? 7.5 : 0;
  const timeScore = temporalUrgency(features);
  return (
    exposureRatio * 30 +
    (features.highestMuleRiskScore / 100) * 25 +
    features.crossCaseLinkage * 15 +
    exitScore +
    timeScore
  );
}

function temporalUrgency(features: CasePriorityFeatures): number {
  if (!features.highestRiskTimeBucket || features.evidenceGateDecision === 'ABSTAIN') return 0;
  const bucketWeight = {
    UNDER_30_MIN: 15,
    '30_TO_60_MIN': 13,
    '1_TO_2_HOURS': 11,
    '2_TO_6_HOURS': 7,
    '6_TO_24_HOURS': 3,
  }[features.highestRiskTimeBucket];
  return bucketWeight * (0.5 + 0.5 * features.forecastConfidence);
}

function operationalStateFor(features: CasePriorityFeatures): OperationalState {
  if (
    features.institutionalOutcome === 'CONFIRMED' ||
    features.institutionalOutcome === 'CLEARED'
  ) {
    return 'OUTCOME_KNOWN';
  }
  if (features.observedCashOut) return 'CASH_OUT_MAY_HAVE_OCCURRED';
  if (
    features.exitMode === 'CASH_OUT_LIKELY' &&
    features.evidenceGateDecision !== 'ABSTAIN' &&
    features.highestRiskTimeBucket !== null &&
    URGENT_BUCKETS.has(features.highestRiskTimeBucket) &&
    features.forecastConfidence >= 0.35
  ) {
    return 'ACTIVE_INTERVENTION_WINDOW';
  }
  if (
    features.exitMode === 'STATIONARY' ||
    features.evidenceGateDecision === 'ABSTAIN' ||
    (features.exitMode === 'NOT_ASSESSED' && features.highestMuleRiskScore < 40)
  ) {
    return 'MONITORING';
  }
  return 'ELEVATED_HORIZON';
}

function reasonsFor(features: CasePriorityFeatures, state: OperationalState): readonly string[] {
  const reasons = new Set<string>([`OPERATIONAL_STATE_${state}`]);
  if (features.maximumAttributableMinor > 0) reasons.add('ATTRIBUTABLE_EXPOSURE_PRESENT');
  if (features.highestMuleRiskScore >= 65) reasons.add('ELEVATED_ACCOUNT_RISK');
  if (features.crossCaseLinkage >= 0.6) reasons.add('CROSS_CASE_LINKAGE_ELEVATED');
  if (features.exitMode === 'CASH_OUT_LIKELY') reasons.add('CASH_OUT_EXIT_MODE_LIKELY');
  if (features.observedCashOut) reasons.add('CASH_OUT_EVENT_OBSERVED');
  if (features.evidenceGateDecision === 'ABSTAIN') reasons.add('FORECAST_EVIDENCE_ABSTAINED');
  if (features.highestRiskTimeBucket) reasons.add(`TIME_BUCKET_${features.highestRiskTimeBucket}`);
  if (features.institutionalOutcome !== 'NONE') {
    reasons.add(`INSTITUTIONAL_OUTCOME_${features.institutionalOutcome}`);
  }
  if (features.complaintLagMinutes >= 120) reasons.add('LATE_COMPLAINT_CONTEXT_ONLY');
  return [...reasons];
}

function actionsFor(
  state: OperationalState,
  band: CasePriorityBand,
  features: CasePriorityFeatures,
): readonly RecommendedAction[] {
  if (state === 'OUTCOME_KNOWN') {
    return features.institutionalOutcome === 'CLEARED'
      ? ['RECORD_OUTCOME']
      : ['RECORD_OUTCOME', 'GENERATE_INTELLIGENCE_PACKET'];
  }
  if (state === 'CASH_OUT_MAY_HAVE_OCCURRED') {
    return withLeaIfCritical(
      ['RECONSTRUCT_AND_LEARN', 'ALERT_BANK', 'GENERATE_INTELLIGENCE_PACKET'],
      band,
    );
  }
  if (state === 'ACTIVE_INTERVENTION_WINDOW') {
    return withLeaIfCritical(
      ['ESCALATE_PRIORITY', 'ALERT_BANK', 'GENERATE_INTELLIGENCE_PACKET'],
      band,
    );
  }
  if (state === 'ELEVATED_HORIZON') return ['PREPARE_ESCALATION', 'MONITOR_CASE'];
  return ['MONITOR_CASE'];
}

function withLeaIfCritical(
  actions: RecommendedAction[],
  band: CasePriorityBand,
): readonly RecommendedAction[] {
  return band === 'CRITICAL' ? [...actions, 'ALERT_LEA'] : actions;
}

function bandFor(score: number): CasePriorityBand {
  if (score >= 85) return 'CRITICAL';
  if (score >= 65) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
