import type {
  AccountExposureState,
  ExitModeFeatureSnapshot,
  ExitModeProviderSignals,
  GraphSnapshot,
  MuleAssessmentSnapshot,
} from '@trishul/contracts';

export interface ExitModeAssessment {
  selectedMode: 'STATIONARY' | 'FORWARD' | 'CASH_OUT_LIKELY';
  confidence: number;
  rankedModes: Array<{
    mode: 'STATIONARY' | 'FORWARD' | 'CASH_OUT_LIKELY';
    probability: number;
    reasonCodes: string[];
  }>;
  ruleVersion: 'exit-mode-v1';
  modelVersion: 'deterministic-exit-v1';
}

function cappedRatio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Math.min(1, numerator / denominator);
}

function hopDepth(graph: GraphSnapshot, accountId: string): number {
  const roots = graph.edges.filter((edge) => edge.type === 'PAID_TO').map((edge) => edge.toNodeId);
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
  return distances.get(accountId) ?? 0;
}

export function deriveExitModeFeatures(
  graph: GraphSnapshot,
  exposure: AccountExposureState,
  risk: MuleAssessmentSnapshot | null,
  providerSignals: ExitModeProviderSignals,
  evaluatedAt: string,
): ExitModeFeatureSnapshot {
  const accountId = exposure.accountId;
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
  const latestIncoming = incoming
    .map((edge) => Date.parse(edge.occurredAt))
    .sort((left, right) => right - left)[0];
  const evaluatedAtMs = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) throw new RangeError('evaluatedAt must be an ISO timestamp');
  const inactivity =
    latestIncoming === undefined
      ? 1
      : Math.min(1, Math.max(0, (evaluatedAtMs - latestIncoming) / (6 * 60 * 60 * 1000)));
  const depth = hopDepth(graph, accountId);
  return {
    recentIncomingVelocity: providerSignals.recentIncomingVelocity,
    recentOutgoingVelocity: providerSignals.recentOutgoingVelocity,
    retainedExposureRatio:
      exposure.fraudLinkedBalanceMinor === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (exposure.fraudLinkedBalanceMinor - exposure.maximumAttributableMinor) /
                exposure.fraudLinkedBalanceMinor,
            ),
          ),
    passThrough: risk?.features.behaviour.passThrough ?? cappedRatio(outgoingMinor, incomingMinor),
    historicalStationary: providerSignals.historicalStationary,
    historicalForward: providerSignals.historicalForward,
    historicalCashOut: providerSignals.historicalCashOut,
    hopDepth: depth,
    hopDepthNormalised: Math.min(1, depth / 4),
    cashOutTendency: Math.max(
      providerSignals.cashOutTendency,
      risk?.features.movement.cashOutTendency ?? 0,
    ),
    inactivity,
    evidenceStrength: providerSignals.evidenceStrength,
  };
}

export function rankExitModes(features: ExitModeFeatureSnapshot): ExitModeAssessment {
  const raw = [
    {
      mode: 'STATIONARY' as const,
      score:
        features.retainedExposureRatio * 0.35 +
        features.inactivity * 0.25 +
        features.historicalStationary * 0.25 +
        (1 - features.passThrough) * 0.15,
      reasonCodes: [
        features.retainedExposureRatio >= 0.6 ? 'EXPOSURE_RETAINED' : null,
        features.inactivity >= 0.6 ? 'NO_RECENT_MOVEMENT' : null,
        features.historicalStationary >= 0.6 ? 'STATIONARY_HISTORY' : null,
      ].filter((value): value is string => value !== null),
    },
    {
      mode: 'FORWARD' as const,
      score:
        features.recentOutgoingVelocity * 0.2 +
        features.passThrough * 0.25 +
        features.historicalForward * 0.2 +
        features.hopDepthNormalised * 0.15 +
        features.recentIncomingVelocity * 0.1 +
        (1 - features.inactivity) * 0.1,
      reasonCodes: [
        features.passThrough >= 0.6 ? 'PASS_THROUGH_PATTERN' : null,
        features.recentIncomingVelocity >= 0.6 ? 'INCOMING_VELOCITY' : null,
        features.recentOutgoingVelocity >= 0.6 ? 'OUTGOING_VELOCITY' : null,
        features.hopDepth >= 2 ? 'DEEPER_NETWORK_HOP' : null,
      ].filter((value): value is string => value !== null),
    },
    {
      mode: 'CASH_OUT_LIKELY' as const,
      score: features.cashOutTendency * 0.55 + features.historicalCashOut * 0.45,
      reasonCodes: [
        features.cashOutTendency >= 0.6 ? 'CASHOUT_TENDENCY' : null,
        features.historicalCashOut >= 0.6 ? 'CASHOUT_HISTORY' : null,
      ].filter((value): value is string => value !== null),
    },
  ];
  const total = raw.reduce((sum, candidate) => sum + candidate.score, 0) || 1;
  const rankedModes = raw
    .map((candidate) => ({
      mode: candidate.mode,
      probability: Number((candidate.score / total).toFixed(3)),
      reasonCodes:
        candidate.reasonCodes.length > 0 ? candidate.reasonCodes : ['NO_DOMINANT_MODE_SIGNAL'],
    }))
    .sort(
      (left, right) => right.probability - left.probability || left.mode.localeCompare(right.mode),
    );
  const selected = rankedModes[0];
  if (!selected) throw new Error('Exit-mode ranking did not produce a candidate');
  return {
    selectedMode: selected.mode,
    confidence: Number((selected.probability * (0.5 + features.evidenceStrength * 0.5)).toFixed(3)),
    rankedModes,
    ruleVersion: 'exit-mode-v1',
    modelVersion: 'deterministic-exit-v1',
  };
}
