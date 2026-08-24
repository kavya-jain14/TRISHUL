import type { ExitModeFeatureSnapshot } from '@trishul/contracts';
import { describe, expect, it } from 'vitest';
import { rankExitModes } from '../src/index.js';

const baseline: ExitModeFeatureSnapshot = {
  recentIncomingVelocity: 0.2,
  recentOutgoingVelocity: 0.1,
  retainedExposureRatio: 0.2,
  passThrough: 0.2,
  historicalStationary: 0.34,
  historicalForward: 0.33,
  historicalCashOut: 0.33,
  hopDepth: 0,
  hopDepthNormalised: 0,
  cashOutTendency: 0.1,
  inactivity: 0.2,
  evidenceStrength: 0.7,
};

describe('rankExitModes', () => {
  it('treats retained inactive funds as a valid stationary outcome', () => {
    const result = rankExitModes({
      ...baseline,
      retainedExposureRatio: 0.95,
      inactivity: 0.9,
      passThrough: 0,
      historicalStationary: 0.8,
      historicalForward: 0.1,
      historicalCashOut: 0.1,
    });

    expect(result.selectedMode).toBe('STATIONARY');
    expect(result.rankedModes[0]?.reasonCodes).toContain('EXPOSURE_RETAINED');
  });

  it('ranks onward transfer when pass-through and outgoing velocity converge', () => {
    const result = rankExitModes({
      ...baseline,
      recentOutgoingVelocity: 0.95,
      passThrough: 0.9,
      historicalStationary: 0.1,
      historicalForward: 0.8,
      historicalCashOut: 0.1,
      hopDepth: 3,
      hopDepthNormalised: 0.75,
      inactivity: 0.05,
    });

    expect(result.selectedMode).toBe('FORWARD');
    expect(result.rankedModes[0]?.reasonCodes).toContain('PASS_THROUGH_PATTERN');
  });

  it('ranks cash-out only from cash-out evidence and history, not intent', () => {
    const result = rankExitModes({
      ...baseline,
      historicalStationary: 0.05,
      historicalForward: 0.05,
      historicalCashOut: 0.9,
      cashOutTendency: 0.95,
      evidenceStrength: 0.9,
    });

    expect(result.selectedMode).toBe('CASH_OUT_LIKELY');
    expect(result.rankedModes[0]?.reasonCodes).toContain('CASHOUT_HISTORY');
  });

  it('calibrates confidence down when the underlying evidence is weak', () => {
    const strong = rankExitModes({ ...baseline, evidenceStrength: 1 });
    const weak = rankExitModes({ ...baseline, evidenceStrength: 0 });

    expect(strong.selectedMode).toBe(weak.selectedMode);
    expect(strong.rankedModes).toEqual(weak.rankedModes);
    expect(weak.confidence).toBeLessThan(strong.confidence);
  });
});
