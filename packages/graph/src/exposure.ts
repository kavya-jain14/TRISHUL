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

export interface GraphExposureEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  type: 'PAID_TO' | 'TRANSFERRED_TO' | 'WITHDREW_AT';
  amount?: { amountMinor: number; currency: 'INR' };
  occurredAt: string;
}

export interface GraphExposureInput {
  edges: readonly GraphExposureEdge[];
  knownCleanBalancesMinor: Readonly<Record<string, number>>;
}

export interface GraphAccountExposure extends ExposureRange {
  accountId: string;
  minimumFraudLinkedBalanceMinor: number;
  fraudLinkedBalanceMinor: number;
  knownCleanBalanceMinor: number;
  nonFraudCompatibleInflowMinor: number;
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

/**
 * Propagates the maximum attributable value through observed financial events, then returns a
 * defensible aggregate range for each fraud-reachable account. The upper-bound allocation spends
 * attributable value first; the lower bound allows known-clean and non-attributable-compatible
 * value to fund outgoing movement first. This deliberately avoids claiming an exact rupee path
 * after commingling.
 */
export function calculateGraphExposure(input: GraphExposureInput): GraphAccountExposure[] {
  const knownClean = new Map(Object.entries(input.knownCleanBalancesMinor));
  for (const [accountId, value] of knownClean) assertMinorUnits(accountId, value);

  const minimumFraudInflow = new Map<string, number>();
  const maximumFraudInflow = new Map<string, number>();
  const maximumCompatibleInflow = new Map<string, number>();
  const availableMinimumFraud = new Map<string, number>();
  const availableMaximumFraud = new Map<string, number>();
  const availableMinimumCompatible = new Map(knownClean);
  const availableMaximumCompatible = new Map(knownClean);
  const outgoing = new Map<string, number>();
  const reachable = new Set<string>();

  const add = (target: Map<string, number>, key: string, amount: number) => {
    target.set(key, (target.get(key) ?? 0) + amount);
  };

  const ordered = [...input.edges]
    .filter((edge) => edge.amount)
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.edgeId.localeCompare(right.edgeId),
    );

  for (const edge of ordered) {
    const amount = edge.amount?.amountMinor;
    if (amount === undefined) continue;
    assertMinorUnits(`edge ${edge.edgeId} amount`, amount);

    if (edge.type === 'PAID_TO') {
      reachable.add(edge.toNodeId);
      add(minimumFraudInflow, edge.toNodeId, amount);
      add(maximumFraudInflow, edge.toNodeId, amount);
      add(availableMinimumFraud, edge.toNodeId, amount);
      add(availableMaximumFraud, edge.toNodeId, amount);
      continue;
    }

    if (!reachable.has(edge.fromNodeId)) continue;
    add(outgoing, edge.fromNodeId, amount);

    const maximumFraudAvailable = availableMaximumFraud.get(edge.fromNodeId) ?? 0;
    const minimumCompatibleAvailable = availableMinimumCompatible.get(edge.fromNodeId) ?? 0;
    if (amount > maximumFraudAvailable + minimumCompatibleAvailable) {
      throw new RangeError(
        `Observed outgoing value at ${edge.fromNodeId} exceeds attributable and balance evidence`,
      );
    }

    const maximumAttributableOnEdge = Math.min(amount, maximumFraudAvailable);
    const minimumCompatibleOnEdge = amount - maximumAttributableOnEdge;
    availableMaximumFraud.set(edge.fromNodeId, maximumFraudAvailable - maximumAttributableOnEdge);
    availableMinimumCompatible.set(
      edge.fromNodeId,
      minimumCompatibleAvailable - minimumCompatibleOnEdge,
    );

    const maximumCompatibleAvailable = availableMaximumCompatible.get(edge.fromNodeId) ?? 0;
    const minimumAttributableOnEdge = Math.max(0, amount - maximumCompatibleAvailable);
    const maximumCompatibleOnEdge = amount - minimumAttributableOnEdge;
    availableMaximumCompatible.set(
      edge.fromNodeId,
      maximumCompatibleAvailable - maximumCompatibleOnEdge,
    );
    availableMinimumFraud.set(
      edge.fromNodeId,
      Math.max(0, (availableMinimumFraud.get(edge.fromNodeId) ?? 0) - minimumAttributableOnEdge),
    );

    if (edge.type === 'TRANSFERRED_TO') {
      reachable.add(edge.toNodeId);
      add(minimumFraudInflow, edge.toNodeId, minimumAttributableOnEdge);
      add(maximumFraudInflow, edge.toNodeId, maximumAttributableOnEdge);
      add(maximumCompatibleInflow, edge.toNodeId, maximumCompatibleOnEdge);
      add(availableMinimumFraud, edge.toNodeId, minimumAttributableOnEdge);
      add(availableMaximumFraud, edge.toNodeId, maximumAttributableOnEdge);
      add(availableMinimumCompatible, edge.toNodeId, minimumCompatibleOnEdge);
      add(availableMaximumCompatible, edge.toNodeId, maximumCompatibleOnEdge);
    }
  }

  for (const accountId of reachable) {
    if (!knownClean.has(accountId)) {
      throw new RangeError(`Known-clean balance evidence is required for ${accountId}`);
    }
  }

  return [...reachable]
    .sort((left, right) => left.localeCompare(right))
    .map((accountId) => {
      const minimumFraudLinkedBalanceMinor = minimumFraudInflow.get(accountId) ?? 0;
      const fraudLinkedBalanceMinor = maximumFraudInflow.get(accountId) ?? 0;
      const knownCleanBalanceMinor = knownClean.get(accountId) ?? 0;
      const nonFraudCompatibleInflowMinor = maximumCompatibleInflow.get(accountId) ?? 0;
      const range = calculateAttributableExposure({
        outgoingAmountMinor: outgoing.get(accountId) ?? 0,
        fraudLinkedBalanceMinor,
        knownCleanBalanceMinor: knownCleanBalanceMinor + nonFraudCompatibleInflowMinor,
      });
      return {
        accountId,
        minimumFraudLinkedBalanceMinor,
        fraudLinkedBalanceMinor,
        knownCleanBalanceMinor,
        nonFraudCompatibleInflowMinor,
        ...range,
      };
    });
}
