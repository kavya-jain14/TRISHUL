import { describe, expect, it } from 'vitest';
import {
  CaseActionRequestSchema,
  CredentialClaimsSchema,
  ForecastSnapshotSchema,
  ExitModeRequestSchema,
  GraphEdgeSchema,
  HistoricalInstitutionalOutcomeSchema,
  IdempotencyKeySchema,
  ProviderEventBatchSchema,
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
  it('requires attributable case-action evidence', () => {
    expect(
      CaseActionRequestSchema.safeParse({
        actionId: 'action-1',
        action: 'ALERT_BANK',
        rationale: 'Provider review is required.',
        evidenceAnchorIds: ['anchor:evidence-1'],
        sourceUrls: ['https://example.test/evidence/1'],
        occurredAt: '2026-08-24T10:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      CaseActionRequestSchema.safeParse({
        actionId: 'action-2',
        action: 'ALERT_BANK',
        rationale: 'Unsupported action.',
        evidenceAnchorIds: [],
        occurredAt: '2026-08-24T10:00:00.000Z',
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

  it('accepts only verified institutional or labelled simulator outcomes for network memory', () => {
    expect(
      HistoricalInstitutionalOutcomeSchema.safeParse({
        status: 'CONFIRMED',
        provenance,
      }).success,
    ).toBe(true);
    expect(
      HistoricalInstitutionalOutcomeSchema.safeParse({
        status: 'CONFIRMED',
        provenance: {
          ...provenance,
          sourceType: 'BANK',
          evidenceState: 'SUBMITTED',
        },
      }).success,
    ).toBe(false);
    expect(
      HistoricalInstitutionalOutcomeSchema.safeParse({
        status: 'CONFIRMED',
        provenance: { ...provenance, sourceType: 'COMPLAINT' },
      }).success,
    ).toBe(false);
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

  it('rejects incoherent or duplicated signed credential claims', () => {
    const claims = {
      credentialId: 'credential:test-a',
      issuerId: 'issuer:test-a',
      subjectId: 'investigator:test-a',
      role: 'INVESTIGATOR',
      capabilities: ['CASE_READ', 'CASE_READ'],
      allowedPurposes: ['FRAUD_INVESTIGATION'],
      caseIds: ['case:test-a'],
      subjectPublicKeyPem: `-----BEGIN PUBLIC KEY-----\n${'A'.repeat(80)}\n-----END PUBLIC KEY-----`,
      issuedAt: '2026-08-24T12:00:00.000Z',
      expiresAt: '2026-08-24T11:00:00.000Z',
    };

    expect(CredentialClaimsSchema.safeParse(claims).success).toBe(false);
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
