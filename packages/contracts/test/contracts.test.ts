import { describe, expect, it } from 'vitest';
import {
  ForecastSnapshotSchema,
  ExitModeRequestSchema,
  GraphEdgeSchema,
  IdempotencyKeySchema,
  ProviderEventBatchSchema,
  ProviderEventSchema,
  TraceGraphExpansionJobSchema,
  assertCaseTransition,
  canTransitionCase,
} from '../src/index.js';

const provenance = {
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL PSP Sandbox',
  sourceEventId: 'sandbox:event-1',
  observedAt: '2026-08-24T10:00:00.000Z',
  evidenceState: 'SIMULATED',
} as const;

describe('shared contracts', () => {
  it('rejects unknown fields in durable worker jobs', () => {
    expect(
      TraceGraphExpansionJobSchema.safeParse({
        caseId: 'case-worker-contract',
        idempotencyKey: 'trace-worker-contract',
      }).success,
    ).toBe(true);
    expect(
      TraceGraphExpansionJobSchema.safeParse({
        caseId: 'case-worker-contract',
        idempotencyKey: 'trace-worker-contract',
        rawProviderPayload: { shouldNotCrossBoundary: true },
      }).success,
    ).toBe(false);
  });
  it('accepts a provenance-backed provider transfer', () => {
    const result = ProviderEventSchema.safeParse({
      eventId: 'evt-transfer-1',
      caseId: 'case-golden-a',
      type: 'TRANSFER',
      occurredAt: '2026-08-24T10:00:00.000Z',
      provenance,
      transactionId: 'T1001',
      providerRef: 'RRN1001',
      fromAccount: 'acct-kavya',
      toAccount: 'acct-receiver-a',
      amount: { amountMinor: 5_000_000, currency: 'INR' },
    });

    expect(result.success).toBe(true);
  });

  it('rejects graph edges without provenance', () => {
    const result = GraphEdgeSchema.safeParse({
      edgeId: 'edge-1',
      caseId: 'case-golden-a',
      fromNodeId: 'acct-a',
      toNodeId: 'acct-b',
      type: 'TRANSFERRED_TO',
      occurredAt: '2026-08-24T10:05:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an event batch when any event has no provenance', () => {
    const result = ProviderEventBatchSchema.safeParse({
      events: [
        {
          eventId: 'evt-without-provenance',
          caseId: 'case-golden-a',
          type: 'TRANSFER',
          occurredAt: '2026-08-24T10:00:00.000Z',
          transactionId: 'T1001',
          providerRef: 'RRN1001',
          fromAccount: 'acct-kavya',
          toAccount: 'acct-receiver-a',
          amount: { amountMinor: 5_000_000, currency: 'INR' },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('validates bounded idempotency keys', () => {
    expect(IdempotencyKeySchema.safeParse('complaint:create:golden-a').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('x'.repeat(97)).success).toBe(false);
  });

  it('accepts independent geo/time abstention as a valid forecast', () => {
    const result = ForecastSnapshotSchema.safeParse({
      predictionRunId: 'run-stationary-1',
      previousPredictionRunId: null,
      evidenceGateRunId: 'gate-stationary-1',
      caseId: 'case-golden-b',
      accountId: 'acct-x',
      generatedAt: '2026-08-24T10:10:00.000Z',
      exitMode: 'STATIONARY',
      evidenceGateDecision: 'ABSTAIN',
      geo: { decision: 'ABSTAIN', reasonCodes: ['INSUFFICIENT_GEO_SUPPORT'] },
      time: { decision: 'ABSTAIN', reasonCodes: ['INSUFFICIENT_TEMPORAL_SUPPORT'] },
      graphVersion: 1,
      featureVersion: 'forecast-features-v1',
      modelVersion: 'deterministic-forecast-v1',
      ruleVersion: 'forecast-policy-v2',
      calculationInputHash: 'a'.repeat(64),
      confidence: 0,
      reasonCodes: ['FUNDS_STATIONARY'],
    });

    expect(result.success).toBe(true);
  });

  it('requires coherent provider history and authorised prediction provenance', () => {
    const validSignals = {
      recentIncomingVelocity: 0.7,
      recentOutgoingVelocity: 0.8,
      historicalStationary: 0.1,
      historicalForward: 0.2,
      historicalCashOut: 0.7,
      cashOutTendency: 0.8,
      evidenceStrength: 0.9,
      provenance,
    };

    expect(
      ExitModeRequestSchema.safeParse({ accountId: 'acct-a', providerSignals: validSignals })
        .success,
    ).toBe(true);
    expect(
      ExitModeRequestSchema.safeParse({
        accountId: 'acct-a',
        providerSignals: {
          ...validSignals,
          historicalCashOut: 0.9,
          provenance: { ...provenance, sourceType: 'COMPLAINT' },
        },
      }).success,
    ).toBe(false);
  });
});

describe('case state machine', () => {
  it('allows the evidence gate to abstain', () => {
    expect(canTransitionCase('EVIDENCE_GATE', 'ABSTAIN')).toBe(true);
  });

  it('rejects impossible jumps', () => {
    expect(() => assertCaseTransition('REPORTED', 'PREDICT')).toThrow(
      'Invalid TRISHUL case transition',
    );
  });
});
