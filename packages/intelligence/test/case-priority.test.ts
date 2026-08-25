import type { CasePriorityFeatures } from '@trishul/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateCasePriority } from '../src/case-priority.js';

const base: CasePriorityFeatures = {
  reportedAmountMinor: 50_000,
  maximumAttributableMinor: 45_000,
  highestMuleRiskScore: 90,
  crossCaseLinkage: 0.9,
  exitMode: 'CASH_OUT_LIKELY',
  evidenceGateDecision: 'PREDICT',
  highestRiskTimeBucket: '1_TO_2_HOURS',
  forecastConfidence: 0.82,
  observedCashOut: false,
  institutionalOutcome: 'NONE',
  complaintLagMinutes: 15,
};

describe('deterministic case priority', () => {
  it('opens an intervention window from attributable, risk, exit, and temporal evidence', () => {
    const decision = evaluateCasePriority(base);
    expect(decision).toMatchObject({
      operationalState: 'ACTIVE_INTERVENTION_WINDOW',
      priorityBand: 'CRITICAL',
    });
    expect(decision.recommendedActions).toContain('ALERT_BANK');
    expect(decision.recommendedActions).toContain('ALERT_LEA');
    expect(decision.reasonCodes).toContain('CROSS_CASE_LINKAGE_ELEVATED');
  });

  it('keeps a stationary, abstaining case in monitoring', () => {
    const decision = evaluateCasePriority({
      ...base,
      maximumAttributableMinor: 5_000,
      highestMuleRiskScore: 25,
      crossCaseLinkage: 0.1,
      exitMode: 'STATIONARY',
      evidenceGateDecision: 'ABSTAIN',
      highestRiskTimeBucket: null,
      forecastConfidence: 0,
    });
    expect(decision.operationalState).toBe('MONITORING');
    expect(decision.priorityBand).toBe('LOW');
    expect(decision.recommendedActions).toEqual(['MONITOR_CASE']);
  });

  it('treats complaint lag as explanation only, never as standalone urgency', () => {
    const decision = evaluateCasePriority({
      ...base,
      maximumAttributableMinor: 0,
      highestMuleRiskScore: 0,
      crossCaseLinkage: 0,
      exitMode: 'NOT_ASSESSED',
      evidenceGateDecision: 'NOT_ASSESSED',
      highestRiskTimeBucket: null,
      forecastConfidence: 0,
      complaintLagMinutes: 1_440,
    });
    expect(decision.priorityBand).toBe('LOW');
    expect(decision.reasonCodes).toContain('LATE_COMPLAINT_CONTEXT_ONLY');
  });

  it('moves observed cash-out to reconstruction without claiming intent', () => {
    const decision = evaluateCasePriority({ ...base, observedCashOut: true });
    expect(decision.operationalState).toBe('CASH_OUT_MAY_HAVE_OCCURRED');
    expect(decision.recommendedActions).toContain('RECONSTRUCT_AND_LEARN');
  });

  it('lets a trusted clearance override network risk', () => {
    const decision = evaluateCasePriority({ ...base, institutionalOutcome: 'CLEARED' });
    expect(decision).toMatchObject({
      operationalState: 'OUTCOME_KNOWN',
      priorityScore: 0,
      priorityBand: 'LOW',
      recommendedActions: ['RECORD_OUTCOME'],
    });
  });
});
