import { describe, expect, it } from 'vitest';
import { calculateAttributableExposure } from '../src/index.js';

describe('calculateAttributableExposure', () => {
  it('returns the defensible range for the locked commingling example', () => {
    expect(
      calculateAttributableExposure({
        knownCleanBalanceMinor: 2_000_000,
        fraudLinkedBalanceMinor: 5_000_000,
        outgoingAmountMinor: 3_000_000,
      }),
    ).toEqual({
      observedOutgoingMinor: 3_000_000,
      minimumAttributableMinor: 1_000_000,
      maximumAttributableMinor: 3_000_000,
      currency: 'INR',
      methodVersion: 'exposure-range-v1',
    });
  });

  it('rejects impossible ledger state', () => {
    expect(() =>
      calculateAttributableExposure({
        knownCleanBalanceMinor: 100,
        fraudLinkedBalanceMinor: 100,
        outgoingAmountMinor: 201,
      }),
    ).toThrow('cannot exceed');
  });
});
