import { describe, expect, it } from 'vitest';
import { assessMuleRisk, type MuleRiskInput } from '../src/index.js';

const baseline: MuleRiskInput = {
  behaviour: {
    volumeVelocity: 0,
    fanIn: 0,
    fanOut: 0,
    passThrough: 0,
    balanceDrain: 0,
    behaviourShift: 0,
  },
  network: {
    reportedNetworkProximity: 0,
    repeatedConvergence: 0,
    crossCaseLinkage: 0,
  },
  movement: { rapidForwarding: 0, splitting: 0, cashOutTendency: 0 },
  entityLinkage: { authorisedSharedIdentifierStrength: 0 },
  trustedOutcome: 'NONE',
};

describe('assessMuleRisk', () => {
  it('does not treat one rapid transfer as a mule verdict', () => {
    const result = assessMuleRisk({
      ...baseline,
      movement: { ...baseline.movement, rapidForwarding: 1 },
    });

    expect(result.state).toBe('NORMAL');
    expect(result.state).not.toBe('CONFIRMED');
  });

  it('can recommend suspected mule from combined behaviour and network evidence', () => {
    const result = assessMuleRisk({
      ...baseline,
      behaviour: {
        volumeVelocity: 0.9,
        fanIn: 0.9,
        fanOut: 0.8,
        passThrough: 0.95,
        balanceDrain: 0.9,
        behaviourShift: 0.8,
      },
      network: {
        reportedNetworkProximity: 0.9,
        repeatedConvergence: 0.85,
        crossCaseLinkage: 0.9,
      },
      movement: { rapidForwarding: 0.9, splitting: 0.8, cashOutTendency: 0.8 },
      entityLinkage: { authorisedSharedIdentifierStrength: 0.7 },
    });

    expect(result.state).toBe('SUSPECTED_MULE');
    expect(result.reasonCodes).toContain('NETWORK_EVIDENCE_CONVERGENCE');
  });

  it('reserves confirmed for a trusted outcome', () => {
    expect(assessMuleRisk({ ...baseline, trustedOutcome: 'CONFIRMED' }).state).toBe('CONFIRMED');
  });
});
