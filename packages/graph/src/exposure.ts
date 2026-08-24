export interface ExposureInput {
  outgoingAmountMinor: number;
  fraudLinkedBalanceMinor: number;
  knownCleanBalanceMinor: number;
}

export interface ExposureRange {
  observedOutgoingMinor: number;
  minimumAttributableMinor: number;
  maximumAttributableMinor: number;
  currency: 'INR';
  methodVersion: 'exposure-range-v1';
}

function assertMinorUnits(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer in minor units`);
  }
}

export function calculateAttributableExposure(input: ExposureInput): ExposureRange {
  assertMinorUnits('outgoingAmountMinor', input.outgoingAmountMinor);
  assertMinorUnits('fraudLinkedBalanceMinor', input.fraudLinkedBalanceMinor);
  assertMinorUnits('knownCleanBalanceMinor', input.knownCleanBalanceMinor);

  const observedBalance = input.fraudLinkedBalanceMinor + input.knownCleanBalanceMinor;
  if (input.outgoingAmountMinor > observedBalance) {
    throw new RangeError('outgoingAmountMinor cannot exceed the observed available balance');
  }

  return {
    observedOutgoingMinor: input.outgoingAmountMinor,
    minimumAttributableMinor: Math.max(0, input.outgoingAmountMinor - input.knownCleanBalanceMinor),
    maximumAttributableMinor: Math.min(input.outgoingAmountMinor, input.fraudLinkedBalanceMinor),
    currency: 'INR',
    methodVersion: 'exposure-range-v1',
  };
}
