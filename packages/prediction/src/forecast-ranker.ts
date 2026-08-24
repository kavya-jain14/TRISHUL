import type {
  EvidenceDimensionDecision,
  ForecastSnapshot,
  GeoCandidateInput,
  TimeHorizonInput,
} from '@trishul/contracts';

type GeoPrediction = Extract<ForecastSnapshot['geo'], { decision: 'PREDICT' }>;
type TimePrediction = Extract<ForecastSnapshot['time'], { decision: 'PREDICT' }>;

function round(value: number): number {
  return Number(value.toFixed(3));
}

function roundDistribution(values: readonly number[]): number[] {
  const rounded = values.map(round);
  const total = rounded.reduce((sum, value) => sum + value, 0);
  const first = rounded[0];
  if (first === undefined) return rounded;
  rounded[0] = round(first + (1 - total));
  return rounded;
}

function assertPositiveTotal(dimension: 'geo' | 'time', total: number): void {
  if (!Number.isFinite(total) || total <= 0) {
    throw new RangeError(`${dimension} candidates require at least one positive evidence signal`);
  }
}

function reasonCodes(values: Array<string | null>, fallback: string): string[] {
  const reasons = values.filter((value): value is string => value !== null);
  return reasons.length > 0 ? reasons : [fallback];
}

export function calibrateForecastConfidence(
  leadingProbability: number,
  gate: EvidenceDimensionDecision,
): number {
  const evidenceCalibration = 0.5 + gate.coverageScore * 0.25 + gate.predictionStability * 0.25;
  return round(leadingProbability * evidenceCalibration);
}

/**
 * Blueprint prototype policy:
 * 0.35 account history + 0.30 network history + 0.15 recency +
 * 0.10 time-of-day similarity + 0.10 amount similarity.
 */
export function rankGeoZones(
  candidates: readonly GeoCandidateInput[],
  gate: EvidenceDimensionDecision,
): GeoPrediction {
  if (gate.decision !== 'PASS') {
    throw new RangeError('geo ranking cannot run when its Evidence Gate abstains');
  }
  if (candidates.length === 0) {
    throw new RangeError('geo ranking requires at least one candidate zone');
  }

  const scored = candidates
    .map((candidate) => {
      const score =
        candidate.features.accountHistory * 0.35 +
        candidate.features.networkHistory * 0.3 +
        candidate.features.recency * 0.15 +
        candidate.features.timeSimilarity * 0.1 +
        candidate.features.amountSimilarity * 0.1;
      const featureContributions = {
        accountHistory: round(candidate.features.accountHistory * 0.35),
        networkHistory: round(candidate.features.networkHistory * 0.3),
        recency: round(candidate.features.recency * 0.15),
        timeSimilarity: round(candidate.features.timeSimilarity * 0.1),
        amountSimilarity: round(candidate.features.amountSimilarity * 0.1),
      };
      return {
        candidate,
        featureContributions,
        score,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.candidate.zoneId.localeCompare(right.candidate.zoneId),
    );
  const total = scored.reduce((sum, candidate) => sum + candidate.score, 0);
  assertPositiveTotal('geo', total);

  const topEntries = scored.slice(0, 3);
  const otherScore = scored.slice(3).reduce((sum, candidate) => sum + candidate.score, 0);
  const distribution = roundDistribution([
    ...topEntries.map((candidate) => candidate.score / total),
    otherScore / total,
  ]);
  const top = topEntries.map((entry, index) => ({
    zoneId: entry.candidate.zoneId,
    label: entry.candidate.label,
    probability: distribution[index] ?? 0,
    reasonCodes: reasonCodes(
      [
        entry.candidate.features.accountHistory >= 0.6 ? 'ACCOUNT_ZONE_HISTORY' : null,
        entry.candidate.features.networkHistory >= 0.6 ? 'NETWORK_ZONE_HISTORY' : null,
        entry.candidate.features.recency >= 0.6 ? 'RECENT_ZONE_USE' : null,
        entry.candidate.features.timeSimilarity >= 0.6 ? 'TIME_OF_DAY_MATCH' : null,
        entry.candidate.features.amountSimilarity >= 0.6 ? 'AMOUNT_PATTERN_MATCH' : null,
      ],
      'DISTRIBUTED_ZONE_SUPPORT',
    ),
    featureContributions: entry.featureContributions,
  }));
  const topProbability = top[0]?.probability ?? 0;

  return {
    decision: 'PREDICT',
    candidates: top,
    otherProbability: distribution.at(-1) ?? 0,
    confidence: calibrateForecastConfidence(topProbability, gate),
    modelVersion: 'weighted-zone-ranker-v1',
  };
}

/**
 * Interpretable prototype time-to-event policy. The weights are demo policy, not
 * scientifically validated constants or production accuracy claims.
 */
export function rankTimeHorizons(
  horizons: readonly TimeHorizonInput[],
  gate: EvidenceDimensionDecision,
): TimePrediction {
  if (gate.decision !== 'PASS') {
    throw new RangeError('time ranking cannot run when its Evidence Gate abstains');
  }
  if (horizons.length !== 5) {
    throw new RangeError('time ranking requires all five non-overlapping horizon buckets');
  }

  const scored = horizons
    .map((horizon) => {
      const score =
        horizon.features.sameAccountDelayHistory * 0.25 +
        horizon.features.networkDelayHistory * 0.2 +
        horizon.features.amountSimilarity * 0.15 +
        horizon.features.velocityAlignment * 0.15 +
        horizon.features.temporalPattern * 0.1 +
        horizon.features.hopDepthSupport * 0.05 +
        horizon.features.similarCaseTiming * 0.1;
      const featureContributions = {
        sameAccountDelayHistory: round(horizon.features.sameAccountDelayHistory * 0.25),
        networkDelayHistory: round(horizon.features.networkDelayHistory * 0.2),
        amountSimilarity: round(horizon.features.amountSimilarity * 0.15),
        velocityAlignment: round(horizon.features.velocityAlignment * 0.15),
        temporalPattern: round(horizon.features.temporalPattern * 0.1),
        hopDepthSupport: round(horizon.features.hopDepthSupport * 0.05),
        similarCaseTiming: round(horizon.features.similarCaseTiming * 0.1),
      };
      return {
        horizon,
        featureContributions,
        score,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.horizon.bucket.localeCompare(right.horizon.bucket),
    );
  const total = scored.reduce((sum, horizon) => sum + horizon.score, 0);
  assertPositiveTotal('time', total);

  const roundedProbabilities = roundDistribution(scored.map((horizon) => horizon.score / total));

  const ranked = scored.map((entry, index) => ({
    bucket: entry.horizon.bucket,
    probability: roundedProbabilities[index] ?? 0,
    reasonCodes: reasonCodes(
      [
        entry.horizon.features.sameAccountDelayHistory >= 0.6 ? 'ACCOUNT_DELAY_HISTORY' : null,
        entry.horizon.features.networkDelayHistory >= 0.6 ? 'NETWORK_DELAY_HISTORY' : null,
        entry.horizon.features.amountSimilarity >= 0.6 ? 'AMOUNT_PATTERN_MATCH' : null,
        entry.horizon.features.velocityAlignment >= 0.6 ? 'VELOCITY_ALIGNMENT' : null,
        entry.horizon.features.temporalPattern >= 0.6 ? 'TEMPORAL_PATTERN_MATCH' : null,
        entry.horizon.features.hopDepthSupport >= 0.6 ? 'HOP_DEPTH_SUPPORT' : null,
        entry.horizon.features.similarCaseTiming >= 0.6 ? 'SIMILAR_CASE_TIMING' : null,
      ],
      'DISTRIBUTED_TEMPORAL_SUPPORT',
    ),
    featureContributions: entry.featureContributions,
  }));
  const highest = ranked[0];
  if (!highest) throw new Error('Time ranking did not produce a horizon');

  return {
    decision: 'PREDICT',
    highestRiskBucket: highest.bucket,
    horizons: ranked,
    confidence: calibrateForecastConfidence(highest.probability, gate),
    modelVersion: 'weighted-time-ranker-v1',
  };
}
