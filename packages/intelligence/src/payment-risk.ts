import {
  PaymentRiskAssessmentSchema,
  PaymentRiskEvaluationRequestSchema,
  type PaymentRiskAssessment,
  type PaymentRiskEvaluationRequest,
  type RiskAssessment,
} from '@trishul/contracts';

export interface PaymentRiskEvaluationContext {
  assessmentId: string;
  evaluatedAt: string;
  calculationInputHash: string;
}

type RiskDimension = RiskAssessment['transactionAnomaly'];

export function evaluatePaymentRisk(
  rawRequest: PaymentRiskEvaluationRequest,
  context: PaymentRiskEvaluationContext,
): PaymentRiskAssessment {
  const request = PaymentRiskEvaluationRequestSchema.parse(rawRequest);
  const transactionAnomaly = transactionRisk(request);
  const receiverBehaviour = receiverRisk(request);
  const networkRisk = networkEvidenceRisk(request);
  const muleState = muleStateFor(receiverBehaviour.score, networkRisk.score);
  const decision = paymentDecision(
    request,
    transactionAnomaly.score,
    receiverBehaviour.score,
    networkRisk.score,
    muleState,
  );
  const reasonCodes = unique([
    ...transactionAnomaly.reasonCodes,
    ...receiverBehaviour.reasonCodes,
    ...networkRisk.reasonCodes,
    ...decision.reasonCodes,
  ]);

  return PaymentRiskAssessmentSchema.parse({
    assessmentId: context.assessmentId,
    paymentReference: request.paymentReference,
    payerReference: request.payerReference,
    receiverReference: request.receiverReference,
    subjectReference: request.receiverReference,
    amount: request.amount,
    occurredAt: request.occurredAt,
    evaluatedAt: context.evaluatedAt,
    trustStatus: request.receiverSignals.trustStatus,
    stepUpStatus: request.stepUp.status,
    transactionAnomaly,
    receiverBehaviour,
    networkRisk,
    muleState,
    decision: decision.value,
    reasonCodes,
    ruleVersion: 'payment-risk-v1',
    featureVersion: 'payment-risk-features-v1',
    calculationInputHash: context.calculationInputHash,
    signalProvenance: {
      payer: request.payerSignals.provenance,
      receiver: request.receiverSignals.provenance,
      network: request.networkSignals.provenance,
    },
  });
}

function transactionRisk(request: PaymentRiskEvaluationRequest): RiskDimension {
  const signals = request.payerSignals;
  const newBeneficiary = signals.priorSuccessfulPaymentsToReceiver === 0 ? 1 : 0;
  const amount = amountAnomaly(request.amount.amountMinor, signals.amountBaseline);
  const time = timeAnomaly(request.occurredAt, signals.usualActiveHoursUtc);
  const velocity = velocityAnomaly(
    signals.transactionsLast10Minutes,
    signals.baselineTransactionsPer10Minutes,
  );
  const device =
    signals.deviceStatus === 'INTEGRITY_FAILED' ? 1 : signals.deviceStatus === 'NEW' ? 0.5 : 0;
  const score = roundedScore(
    newBeneficiary * 0.2 + amount * 0.3 + time * 0.15 + velocity * 0.2 + device * 0.15,
  );
  const reasonCodes: string[] = [];
  if (newBeneficiary === 1) reasonCodes.push('NEW_BENEFICIARY');
  if (signals.amountBaseline === null) reasonCodes.push('AMOUNT_BASELINE_UNAVAILABLE');
  else if (amount >= 0.6) reasonCodes.push('PAYER_AMOUNT_ANOMALY');
  if (signals.usualActiveHoursUtc === null) reasonCodes.push('TIME_BASELINE_UNAVAILABLE');
  else if (time >= 0.6) reasonCodes.push('UNUSUAL_PAYMENT_TIME');
  if (velocity >= 0.6) reasonCodes.push('PAYER_VELOCITY_SPIKE');
  if (signals.deviceStatus === 'NEW') reasonCodes.push('NEW_DEVICE');
  if (signals.deviceStatus === 'INTEGRITY_FAILED') reasonCodes.push('DEVICE_INTEGRITY_FAILED');
  if (reasonCodes.length === 0) reasonCodes.push('PAYER_PATTERN_WITHIN_BASELINE');
  return dimension(score, reasonCodes);
}

function receiverRisk(request: PaymentRiskEvaluationRequest): RiskDimension {
  const signals = request.receiverSignals;
  const score = roundedScore(
    signals.inflowSpike * 0.3 +
      signals.uniqueSenderSpike * 0.2 +
      signals.passThroughRisk * 0.3 +
      signals.behaviourShift * 0.2,
  );
  const reasonCodes: string[] = [];
  if (signals.inflowSpike >= 0.6) reasonCodes.push('RECEIVER_INFLOW_SPIKE');
  if (signals.uniqueSenderSpike >= 0.6) reasonCodes.push('RECEIVER_SENDER_DIVERSITY_SPIKE');
  if (signals.passThroughRisk >= 0.6) reasonCodes.push('RECEIVER_PASS_THROUGH_PATTERN');
  if (signals.behaviourShift >= 0.6) reasonCodes.push('RECEIVER_BEHAVIOUR_SHIFT');
  if (reasonCodes.length === 0) reasonCodes.push('NO_MATERIAL_RECEIVER_BEHAVIOUR_ANOMALY');
  return dimension(score, reasonCodes);
}

function networkEvidenceRisk(request: PaymentRiskEvaluationRequest): RiskDimension {
  const signals = request.networkSignals;
  const score = roundedScore(
    signals.reportedNetworkProximity * 0.4 +
      signals.crossCaseLinkage * 0.35 +
      signals.trustedExternalIntelligence * 0.25,
  );
  const reasonCodes: string[] = [];
  if (signals.reportedNetworkProximity >= 0.6) reasonCodes.push('REPORTED_NETWORK_PROXIMITY');
  if (signals.crossCaseLinkage >= 0.6) reasonCodes.push('CROSS_CASE_NETWORK_LINKAGE');
  if (signals.trustedExternalIntelligence >= 0.6) {
    reasonCodes.push('TRUSTED_EXTERNAL_NETWORK_SIGNAL');
  }
  if (reasonCodes.length === 0) reasonCodes.push('NO_MATERIAL_NETWORK_EVIDENCE');
  return dimension(score, reasonCodes);
}

function paymentDecision(
  request: PaymentRiskEvaluationRequest,
  transactionScore: number,
  receiverScore: number,
  networkScore: number,
  muleState: PaymentRiskAssessment['muleState'],
): { value: PaymentRiskAssessment['decision']; reasonCodes: string[] } {
  const trustInvalid = ['INVALID', 'REVOKED'].includes(request.receiverSignals.trustStatus);
  const downstreamRisk =
    receiverScore >= 65 || networkScore >= 65 || muleState === 'SUSPECTED_MULE';
  const combinedScore = transactionScore * 0.45 + receiverScore * 0.35 + networkScore * 0.2;
  const transactionNeedsStepUp = transactionScore >= 45;
  const stepUpSatisfied = request.stepUp.status === 'VERIFIED';

  if (trustInvalid) {
    return { value: 'STEP_UP', reasonCodes: ['RECEIVER_TRUST_REQUIRES_REVIEW'] };
  }
  if (downstreamRisk) {
    return {
      value: 'STEP_UP',
      reasonCodes:
        request.receiverSignals.trustStatus === 'VERIFIED'
          ? ['VERIFIED_TRUST_DOES_NOT_OVERRIDE_RISK']
          : ['DOWNSTREAM_RISK_REQUIRES_REVIEW'],
    };
  }
  if (transactionNeedsStepUp && !stepUpSatisfied) {
    return { value: 'STEP_UP', reasonCodes: ['PAYER_STEP_UP_REQUIRED'] };
  }
  if (transactionNeedsStepUp && stepUpSatisfied && receiverScore < 40 && networkScore < 40) {
    return { value: 'ALLOW', reasonCodes: ['PAYER_STEP_UP_SATISFIED'] };
  }
  if (combinedScore >= 30) {
    return { value: 'WARN', reasonCodes: ['MULTI_SIGNAL_CAUTION'] };
  }
  return { value: 'ALLOW', reasonCodes: ['NO_MATERIAL_MULTI_SIGNAL_RISK'] };
}

function amountAnomaly(
  amountMinor: number,
  baseline: PaymentRiskEvaluationRequest['payerSignals']['amountBaseline'],
): number {
  if (baseline === null || amountMinor <= baseline.medianMinor) return 0;
  const robustScale = Math.max(1, baseline.medianAbsoluteDeviationMinor * 1.4826);
  const robustZ = (amountMinor - baseline.medianMinor) / robustScale;
  return Math.min(1, robustZ / 6);
}

function timeAnomaly(
  occurredAt: string,
  activeHours: PaymentRiskEvaluationRequest['payerSignals']['usualActiveHoursUtc'],
): number {
  if (activeHours === null) return 0;
  const hour = new Date(occurredAt).getUTCHours();
  const inside =
    activeHours.startHourUtc <= activeHours.endHourUtc
      ? hour >= activeHours.startHourUtc && hour <= activeHours.endHourUtc
      : hour >= activeHours.startHourUtc || hour <= activeHours.endHourUtc;
  return inside ? 0 : 1;
}

function velocityAnomaly(current: number, baseline: number): number {
  if (baseline === 0) return current <= 1 ? 0 : Math.min(1, (current - 1) / 4);
  return Math.min(1, Math.max(0, (current - baseline) / Math.max(1, baseline * 2)));
}

function muleStateFor(
  receiverScore: number,
  networkScore: number,
): PaymentRiskAssessment['muleState'] {
  const score = receiverScore * 0.55 + networkScore * 0.45;
  if (score >= 75) return 'SUSPECTED_MULE';
  if (score >= 50) return 'WATCH';
  if (score >= 30) return 'ANOMALOUS';
  return 'NORMAL';
}

function dimension(score: number, reasonCodes: string[]): RiskDimension {
  return {
    score,
    band: score >= 75 ? 'HIGH' : score >= 50 ? 'ELEVATED' : score >= 25 ? 'MODERATE' : 'LOW',
    reasonCodes,
  };
}

function roundedScore(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
