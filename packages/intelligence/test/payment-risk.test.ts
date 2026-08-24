import type { PaymentRiskEvaluationRequest } from '@trishul/contracts';
import { describe, expect, it } from 'vitest';
import { evaluatePaymentRisk } from '../src/index.js';

const provenance = {
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL Demo Bank',
  sourceEventId: 'risk-signal:golden-payment',
  observedAt: '2026-08-25T04:30:00.000Z',
  evidenceState: 'SIMULATED',
} as const;

const baseline: PaymentRiskEvaluationRequest = {
  paymentReference: 'payment:golden-new-beneficiary',
  payerReference: 'acct:kavya',
  receiverReference: 'acct:receiver-a',
  amount: { amountMinor: 500_000, currency: 'INR' },
  occurredAt: '2026-08-25T04:30:00.000Z',
  payerSignals: {
    priorSuccessfulPaymentsToReceiver: 0,
    amountBaseline: {
      medianMinor: 100_000,
      medianAbsoluteDeviationMinor: 10_000,
      sampleSize: 20,
    },
    transactionsLast10Minutes: 1,
    baselineTransactionsPer10Minutes: 1,
    usualActiveHoursUtc: { startHourUtc: 3, endHourUtc: 18 },
    deviceStatus: 'KNOWN_TRUSTED',
    provenance,
  },
  receiverSignals: {
    trustStatus: 'VERIFIED',
    inflowSpike: 0.1,
    uniqueSenderSpike: 0.1,
    passThroughRisk: 0.05,
    behaviourShift: 0.1,
    provenance,
  },
  networkSignals: {
    reportedNetworkProximity: 0,
    crossCaseLinkage: 0,
    trustedExternalIntelligence: 0,
    provenance,
  },
  stepUp: { status: 'NOT_PERFORMED' },
};

const context = {
  assessmentId: 'assessment:payment-risk-1',
  evaluatedAt: '2026-08-25T04:30:01.000Z',
  calculationInputHash: 'a'.repeat(64),
};

describe('pre-payment risk policy', () => {
  it('steps up a high-value new-beneficiary payment without calling it fraud', () => {
    const result = evaluatePaymentRisk(baseline, context);

    expect(result.decision).toBe('STEP_UP');
    expect(result.muleState).toBe('NORMAL');
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(['NEW_BENEFICIARY', 'PAYER_AMOUNT_ANOMALY', 'PAYER_STEP_UP_REQUIRED']),
    );
    expect(result.reasonCodes.join(' ')).not.toMatch(/intent|fraudulent|scammer/i);
  });

  it('allows the same low-downstream-risk payment after provider-verified step-up', () => {
    const result = evaluatePaymentRisk(
      {
        ...baseline,
        stepUp: {
          status: 'VERIFIED',
          verificationReference: 'step-up:bank-verified-1',
          verifiedAt: '2026-08-25T04:30:05.000Z',
          provenance,
        },
      },
      context,
    );

    expect(result.decision).toBe('ALLOW');
    expect(result.transactionAnomaly.score).toBeGreaterThanOrEqual(45);
    expect(result.reasonCodes).toContain('PAYER_STEP_UP_SATISFIED');
  });

  it('does not let a verified receiver credential override behavioural and network risk', () => {
    const result = evaluatePaymentRisk(
      {
        ...baseline,
        receiverSignals: {
          ...baseline.receiverSignals,
          inflowSpike: 0.95,
          uniqueSenderSpike: 0.9,
          passThroughRisk: 0.95,
          behaviourShift: 0.85,
        },
        networkSignals: {
          ...baseline.networkSignals,
          reportedNetworkProximity: 0.95,
          crossCaseLinkage: 0.9,
          trustedExternalIntelligence: 0.85,
        },
        stepUp: {
          status: 'VERIFIED',
          verificationReference: 'step-up:bank-verified-2',
          verifiedAt: '2026-08-25T04:30:05.000Z',
          provenance,
        },
      },
      context,
    );

    expect(result.trustStatus).toBe('VERIFIED');
    expect(result.muleState).toBe('SUSPECTED_MULE');
    expect(result.muleState).not.toBe('CONFIRMED');
    expect(result.decision).toBe('STEP_UP');
    expect(result.reasonCodes).toContain('VERIFIED_TRUST_DOES_NOT_OVERRIDE_RISK');
  });
});
