import { describe, expect, it } from 'vitest';
import { calculateAttributableExposure, calculateGraphExposure } from '../src/index.js';

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

  it('propagates upper-bound value without turning commingled funds into an exact claim', () => {
    const exposure = calculateGraphExposure({
      knownCleanBalancesMinor: {
        'acct-a': 2_000_000,
        'acct-b': 0,
        'acct-c': 0,
      },
      edges: [
        {
          edgeId: 'edge:payment',
          fromNodeId: 'acct-victim',
          toNodeId: 'acct-a',
          type: 'PAID_TO',
          amount: { amountMinor: 5_000_000, currency: 'INR' },
          occurredAt: '2026-08-24T10:00:00.000Z',
        },
        {
          edgeId: 'edge:forward',
          fromNodeId: 'acct-a',
          toNodeId: 'acct-b',
          type: 'TRANSFERRED_TO',
          amount: { amountMinor: 3_000_000, currency: 'INR' },
          occurredAt: '2026-08-24T10:05:00.000Z',
        },
        {
          edgeId: 'edge:forward-again',
          fromNodeId: 'acct-b',
          toNodeId: 'acct-c',
          type: 'TRANSFERRED_TO',
          amount: { amountMinor: 3_000_000, currency: 'INR' },
          occurredAt: '2026-08-24T10:10:00.000Z',
        },
      ],
    });

    expect(exposure.find((state) => state.accountId === 'acct-a')).toMatchObject({
      observedOutgoingMinor: 3_000_000,
      minimumAttributableMinor: 1_000_000,
      maximumAttributableMinor: 3_000_000,
    });
    expect(exposure.find((state) => state.accountId === 'acct-b')).toMatchObject({
      minimumFraudLinkedBalanceMinor: 1_000_000,
      fraudLinkedBalanceMinor: 3_000_000,
      nonFraudCompatibleInflowMinor: 2_000_000,
      observedOutgoingMinor: 3_000_000,
      minimumAttributableMinor: 1_000_000,
      maximumAttributableMinor: 3_000_000,
    });
  });

  it('requires explicit known-clean balance evidence for every reachable account', () => {
    expect(() =>
      calculateGraphExposure({
        knownCleanBalancesMinor: { 'acct-a': 0 },
        edges: [
          {
            edgeId: 'edge:payment',
            fromNodeId: 'acct-victim',
            toNodeId: 'acct-a',
            type: 'PAID_TO',
            amount: { amountMinor: 500, currency: 'INR' },
            occurredAt: '2026-08-24T10:00:00.000Z',
          },
          {
            edgeId: 'edge:forward',
            fromNodeId: 'acct-a',
            toNodeId: 'acct-b',
            type: 'TRANSFERRED_TO',
            amount: { amountMinor: 300, currency: 'INR' },
            occurredAt: '2026-08-24T10:05:00.000Z',
          },
        ],
      }),
    ).toThrow('acct-b');
  });
});
