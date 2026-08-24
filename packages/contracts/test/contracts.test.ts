import { describe, expect, it } from 'vitest';
import {
  ForecastSnapshotSchema,
  GraphEdgeSchema,
  ProviderEventSchema,
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

  it('accepts independent geo/time abstention as a valid forecast', () => {
    const result = ForecastSnapshotSchema.safeParse({
      predictionRunId: 'run-stationary-1',
      caseId: 'case-golden-b',
      generatedAt: '2026-08-24T10:10:00.000Z',
      exitMode: 'STATIONARY',
      evidenceGate: {
        outcome: 'ABSTAIN',
        coverageScore: 0.31,
        reasonCodes: ['INSUFFICIENT_HISTORY'],
        missingEvidence: ['CASHOUT_HISTORY', 'NETWORK_SUPPORT'],
        ruleVersion: 'evidence-gate-v1',
      },
      geo: { decision: 'ABSTAIN', reasonCodes: ['INSUFFICIENT_GEO_SUPPORT'] },
      time: { decision: 'ABSTAIN', reasonCodes: ['INSUFFICIENT_TEMPORAL_SUPPORT'] },
      graphVersion: 1,
      featureVersion: 'features-v1',
      modelVersion: 'prototype-rules-v1',
      ruleVersion: 'forecast-policy-v1',
      confidence: 0.31,
      reasonCodes: ['FUNDS_STATIONARY'],
    });

    expect(result.success).toBe(true);
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
