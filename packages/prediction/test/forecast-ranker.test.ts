import type {
  EvidenceDimensionDecision,
  ForecastTimeBucket,
  GeoCandidateInput,
  TimeHorizonInput,
} from '@trishul/contracts';
import { describe, expect, it } from 'vitest';
import { rankGeoZones, rankTimeHorizons } from '../src/index.js';

const provenance = {
  sourceType: 'SIMULATOR' as const,
  sourceName: 'TRISHUL Forecast Lab',
  sourceEventId: 'forecast-lab-v1',
  observedAt: '2026-08-24T12:00:00.000Z',
  evidenceState: 'SIMULATED' as const,
};

const passingGate: EvidenceDimensionDecision = {
  decision: 'PASS',
  coverageState: 'HIGH',
  coverageScore: 0.85,
  predictionStability: 0.8,
  reasonCodes: ['EVIDENCE_GATE_PASSED'],
  missingEvidence: [],
  formulaVersion: 'evidence-coverage-v1',
  provenance,
};

const zones: GeoCandidateInput[] = [
  {
    zoneId: 'zone-noida-sector-62',
    label: 'Noida Sector 62',
    features: {
      accountHistory: 0.9,
      networkHistory: 0.8,
      recency: 0.7,
      timeSimilarity: 0.8,
      amountSimilarity: 0.7,
    },
    provenance,
  },
  {
    zoneId: 'zone-delhi-east',
    label: 'Delhi East',
    features: {
      accountHistory: 0.6,
      networkHistory: 0.7,
      recency: 0.5,
      timeSimilarity: 0.6,
      amountSimilarity: 0.4,
    },
    provenance,
  },
  {
    zoneId: 'zone-ghaziabad',
    label: 'Ghaziabad',
    features: {
      accountHistory: 0.4,
      networkHistory: 0.6,
      recency: 0.4,
      timeSimilarity: 0.5,
      amountSimilarity: 0.5,
    },
    provenance,
  },
  {
    zoneId: 'zone-gurugram',
    label: 'Gurugram',
    features: {
      accountHistory: 0.2,
      networkHistory: 0.3,
      recency: 0.2,
      timeSimilarity: 0.4,
      amountSimilarity: 0.3,
    },
    provenance,
  },
];

const bucketScores: Record<ForecastTimeBucket, number> = {
  UNDER_30_MIN: 0.3,
  '30_TO_60_MIN': 0.5,
  '1_TO_2_HOURS': 0.9,
  '2_TO_6_HOURS': 0.6,
  '6_TO_24_HOURS': 0.2,
};

const horizons: TimeHorizonInput[] = Object.entries(bucketScores).map(([bucket, score]) => ({
  bucket: bucket as ForecastTimeBucket,
  features: {
    sameAccountDelayHistory: score,
    networkDelayHistory: score,
    amountSimilarity: score,
    velocityAlignment: score,
    temporalPattern: score,
    hopDepthSupport: score,
    similarCaseTiming: score,
  },
  provenance: { ...provenance, sourceEventId: `time-${bucket}` },
}));

describe('Phase 4 forecast rankers', () => {
  it('normalises the locked zone formula into top three plus Other', () => {
    const result = rankGeoZones(zones, passingGate);
    const total =
      result.candidates.reduce((sum, candidate) => sum + candidate.probability, 0) +
      result.otherProbability;

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.zoneId)).toEqual([
      'zone-noida-sector-62',
      'zone-delhi-east',
      'zone-ghaziabad',
    ]);
    expect(result.candidates[0]?.featureContributions).toEqual({
      accountHistory: 0.315,
      networkHistory: 0.24,
      recency: 0.105,
      timeSimilarity: 0.08,
      amountSimilarity: 0.07,
    });
    expect(total).toBe(1);
    expect(result.otherProbability).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('endpointReference');
  });

  it('returns all five ranked time buckets and never an exact minute', () => {
    const result = rankTimeHorizons(horizons, passingGate);

    expect(result.highestRiskBucket).toBe('1_TO_2_HOURS');
    expect(result.horizons).toHaveLength(5);
    expect(result.horizons.reduce((sum, horizon) => sum + horizon.probability, 0)).toBe(1);
    expect(result).not.toHaveProperty('predictedMinute');
  });

  it('refuses ranking when the independent Evidence Gate abstains', () => {
    const abstainingGate: EvidenceDimensionDecision = {
      ...passingGate,
      decision: 'ABSTAIN',
      coverageState: 'INSUFFICIENT',
      reasonCodes: ['INSUFFICIENT_EVIDENCE'],
      missingEvidence: ['HISTORICAL_SUPPORT'],
    };

    expect(() => rankGeoZones(zones, abstainingGate)).toThrow('Evidence Gate abstains');
    expect(() => rankTimeHorizons(horizons, abstainingGate)).toThrow('Evidence Gate abstains');
  });

  it('requires every non-overlapping time bucket', () => {
    expect(() => rankTimeHorizons(horizons.slice(0, 4), passingGate)).toThrow(
      'all five non-overlapping horizon buckets',
    );
  });
});
