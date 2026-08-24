import type {
  GraphSnapshot,
  MuleFeatureSnapshot,
  MuleRiskState,
  ProviderRiskSignals,
} from '@trishul/contracts';

type NormalisedSignal = number;

export interface MuleRiskInput extends MuleFeatureSnapshot {
  trustedOutcome: 'NONE' | 'CONFIRMED' | 'CLEARED';
}

export interface MuleRiskResult {
  score: number;
  state: MuleRiskState;
  reasonCodes: string[];
  ruleVersion: 'mule-risk-v1';
}

function cappedRatio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Math.min(1, numerator / denominator);
}

function reportedNetworkProximity(graph: GraphSnapshot, accountId: string): number {
  const roots = graph.edges.filter((edge) => edge.type === 'PAID_TO').map((edge) => edge.toNodeId);
  if (roots.includes(accountId)) return 1;

  const distances = new Map(roots.map((root) => [root, 0]));
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const distance = distances.get(current) ?? 0;
    for (const edge of graph.edges) {
      if (edge.type !== 'TRANSFERRED_TO' || edge.fromNodeId !== current) continue;
      if (distances.has(edge.toNodeId)) continue;
      distances.set(edge.toNodeId, distance + 1);
      queue.push(edge.toNodeId);
    }
  }

  const distance = distances.get(accountId);
  if (distance === undefined) return 0;
  return Math.max(0, 1 - distance * 0.25);
}

export function deriveMuleRiskFeatures(
  graph: GraphSnapshot,
  accountId: string,
  providerSignals: ProviderRiskSignals,
): MuleFeatureSnapshot {
  if (!graph.nodes.some((node) => node.nodeId === accountId && node.type === 'ACCOUNT')) {
    throw new RangeError(
      `Account ${accountId} is not present in graph version ${graph.graphVersion}`,
    );
  }

  const incoming = graph.edges.filter(
    (edge) =>
      edge.toNodeId === accountId &&
      (edge.type === 'PAID_TO' || edge.type === 'TRANSFERRED_TO') &&
      edge.amount,
  );
  const outgoing = graph.edges.filter(
    (edge) =>
      edge.fromNodeId === accountId &&
      (edge.type === 'TRANSFERRED_TO' || edge.type === 'WITHDREW_AT') &&
      edge.amount,
  );
  const incomingMinor = incoming.reduce((sum, edge) => sum + (edge.amount?.amountMinor ?? 0), 0);
  const outgoingMinor = outgoing.reduce((sum, edge) => sum + (edge.amount?.amountMinor ?? 0), 0);
  const uniqueSenders = new Set(incoming.map((edge) => edge.fromNodeId)).size;
  const uniqueTargets = new Set(outgoing.map((edge) => edge.toNodeId)).size;
  const firstIncomingAt = incoming
    .map((edge) => Date.parse(edge.occurredAt))
    .sort((left, right) => left - right)[0];
  const firstOutgoingAt = outgoing
    .map((edge) => Date.parse(edge.occurredAt))
    .sort((left, right) => left - right)[0];
  const forwardingDelayMinutes =
    firstIncomingAt === undefined ||
    firstOutgoingAt === undefined ||
    firstOutgoingAt < firstIncomingAt
      ? Number.POSITIVE_INFINITY
      : (firstOutgoingAt - firstIncomingAt) / 60_000;
  const rapidForwarding = forwardingDelayMinutes <= 15 ? 1 : forwardingDelayMinutes <= 60 ? 0.6 : 0;

  return {
    behaviour: {
      inflowSpike: providerSignals.inflowSpike,
      uniqueSenderSpike: providerSignals.uniqueSenderSpike,
      firstTimeSenderRatio: providerSignals.firstTimeSenderRatio,
      fanIn: Math.min(1, uniqueSenders / 3),
      fanOut: Math.min(1, uniqueTargets / 3),
      passThrough: cappedRatio(outgoingMinor, incomingMinor),
      balanceDrain: cappedRatio(outgoingMinor, incomingMinor),
      behaviourShift: providerSignals.behaviourShift,
    },
    network: {
      reportedNetworkProximity: reportedNetworkProximity(graph, accountId),
      repeatedConvergence: Math.min(1, Math.max(0, uniqueSenders - 1) / 2),
      crossCaseLinkage: providerSignals.crossCaseLinkage,
    },
    movement: {
      rapidForwarding,
      splitting: Math.min(1, Math.max(0, outgoing.length - 1) / 2),
      cashOutTendency: outgoing.some((edge) => edge.type === 'WITHDREW_AT') ? 1 : 0,
    },
    entityLinkage: {
      authorisedSharedIdentifierStrength: providerSignals.authorisedSharedIdentifierStrength,
    },
  };
}

function checkedAverage(values: number[]): number {
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError('Mule-risk signals must be normalised between 0 and 1');
    }
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function assessMuleRisk(input: MuleRiskInput): MuleRiskResult {
  if (input.trustedOutcome === 'CONFIRMED') {
    return {
      score: 100,
      state: 'CONFIRMED',
      reasonCodes: ['TRUSTED_INSTITUTIONAL_OUTCOME'],
      ruleVersion: 'mule-risk-v1',
    };
  }

  if (input.trustedOutcome === 'CLEARED') {
    return {
      score: 0,
      state: 'NORMAL',
      reasonCodes: ['TRUSTED_CLEARANCE_OUTCOME'],
      ruleVersion: 'mule-risk-v1',
    };
  }

  const behaviour = checkedAverage(Object.values(input.behaviour));
  const network = checkedAverage(Object.values(input.network));
  const movement = checkedAverage(Object.values(input.movement));
  const entityLinkage = checkedAverage(Object.values(input.entityLinkage));
  const score = Math.round(
    (behaviour * 0.35 + network * 0.35 + movement * 0.2 + entityLinkage * 0.1) * 100,
  );

  const reasonCodes: string[] = [];
  if (behaviour >= 0.6) reasonCodes.push('BEHAVIOUR_ANOMALY_CLUSTER');
  if (network >= 0.6) reasonCodes.push('NETWORK_EVIDENCE_CONVERGENCE');
  if (movement >= 0.6) reasonCodes.push('RAPID_ROUTING_PATTERN');
  if (entityLinkage >= 0.6) reasonCodes.push('AUTHORISED_ENTITY_LINKAGE');

  let state: MuleRiskState = 'NORMAL';
  if (score >= 75) state = 'SUSPECTED_MULE';
  else if (score >= 50) state = 'WATCH';
  else if (score >= 30) state = 'ANOMALOUS';

  return {
    score,
    state,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['NO_MATERIAL_MULTI_SIGNAL_EVIDENCE'],
    ruleVersion: 'mule-risk-v1',
  };
}
