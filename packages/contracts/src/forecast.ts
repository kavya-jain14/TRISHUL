import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';
import { ProvenanceSchema } from './common.js';

export const ExitModeSchema = z.enum(['STATIONARY', 'FORWARD', 'CASH_OUT_LIKELY', 'UNKNOWN']);

export const EvidenceGateResultSchema = z
  .object({
    outcome: z.enum(['PASS', 'ABSTAIN']),
    coverageScore: z.number().min(0).max(1),
    reasonCodes: z.array(IdentifierSchema),
    missingEvidence: z.array(IdentifierSchema),
    ruleVersion: IdentifierSchema,
  })
  .strict();

export type EvidenceGateResult = z.infer<typeof EvidenceGateResultSchema>;

const NormalisedSignalSchema = z.number().min(0).max(1);

const AuthorisedPredictionProvenanceSchema = ProvenanceSchema.refine(
  (value) => ['BANK', 'PSP', 'FI', 'SIMULATOR'].includes(value.sourceType),
  'Prediction evidence must come from a bank, PSP, FI, or labelled simulator',
);

export const ExitModeProviderSignalsSchema = z
  .object({
    recentIncomingVelocity: NormalisedSignalSchema,
    recentOutgoingVelocity: NormalisedSignalSchema,
    historicalStationary: NormalisedSignalSchema,
    historicalForward: NormalisedSignalSchema,
    historicalCashOut: NormalisedSignalSchema,
    cashOutTendency: NormalisedSignalSchema,
    evidenceStrength: NormalisedSignalSchema,
    provenance: AuthorisedPredictionProvenanceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const total = value.historicalStationary + value.historicalForward + value.historicalCashOut;
    if (Math.abs(total - 1) > 0.001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['historicalStationary'],
        message: 'Historical exit-mode proportions must sum to 1',
      });
    }
  });

export const ExitModeRequestSchema = z
  .object({
    accountId: IdentifierSchema,
    providerSignals: ExitModeProviderSignalsSchema,
  })
  .strict();

export const ExitModeFeatureSnapshotSchema = z
  .object({
    recentIncomingVelocity: NormalisedSignalSchema,
    recentOutgoingVelocity: NormalisedSignalSchema,
    retainedExposureRatio: NormalisedSignalSchema,
    passThrough: NormalisedSignalSchema,
    historicalStationary: NormalisedSignalSchema,
    historicalForward: NormalisedSignalSchema,
    historicalCashOut: NormalisedSignalSchema,
    hopDepth: z.number().int().nonnegative(),
    hopDepthNormalised: NormalisedSignalSchema,
    cashOutTendency: NormalisedSignalSchema,
    inactivity: NormalisedSignalSchema,
    evidenceStrength: NormalisedSignalSchema,
  })
  .strict();

export const ExitModeCandidateSchema = z
  .object({
    mode: z.enum(['STATIONARY', 'FORWARD', 'CASH_OUT_LIKELY']),
    probability: NormalisedSignalSchema,
    reasonCodes: z.array(IdentifierSchema).min(1),
  })
  .strict();

export const ExitModeSnapshotSchema = z
  .object({
    exitModeRunId: IdentifierSchema,
    caseId: IdentifierSchema,
    accountId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    selectedMode: z.enum(['STATIONARY', 'FORWARD', 'CASH_OUT_LIKELY']),
    confidence: NormalisedSignalSchema,
    rankedModes: z.array(ExitModeCandidateSchema).length(3),
    features: ExitModeFeatureSnapshotSchema,
    featureVersion: z.literal('exit-features-v1'),
    modelVersion: z.literal('deterministic-exit-v1'),
    ruleVersion: z.literal('exit-mode-v1'),
    calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    signalProvenance: AuthorisedPredictionProvenanceSchema,
    evaluatedAt: IsoDateTimeSchema,
  })
  .strict();

export const EvidenceDimensionInputSchema = z
  .object({
    sameAccountHistory: NormalisedSignalSchema,
    connectedNetworkHistory: NormalisedSignalSchema,
    graphConfidence: NormalisedSignalSchema,
    historicalSupport: NormalisedSignalSchema,
    predictionStability: NormalisedSignalSchema,
    provenance: AuthorisedPredictionProvenanceSchema,
  })
  .strict();

export const ForecastEvidenceRequestSchema = z
  .object({
    accountId: IdentifierSchema,
    geo: EvidenceDimensionInputSchema,
    time: EvidenceDimensionInputSchema,
  })
  .strict();

export const EvidenceDimensionDecisionSchema = z
  .object({
    decision: z.enum(['PASS', 'ABSTAIN']),
    coverageState: z.enum(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT']),
    coverageScore: NormalisedSignalSchema,
    predictionStability: NormalisedSignalSchema,
    reasonCodes: z.array(IdentifierSchema).min(1),
    missingEvidence: z.array(IdentifierSchema),
    formulaVersion: z.literal('evidence-coverage-v1'),
    provenance: AuthorisedPredictionProvenanceSchema,
  })
  .strict();

export const EvidenceGateSnapshotSchema = z
  .object({
    evidenceGateRunId: IdentifierSchema,
    caseId: IdentifierSchema,
    accountId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    exitModeRunId: IdentifierSchema,
    exitMode: z.enum(['STATIONARY', 'FORWARD', 'CASH_OUT_LIKELY']),
    overallDecision: z.enum(['PREDICT', 'PARTIAL', 'ABSTAIN']),
    geo: EvidenceDimensionDecisionSchema,
    time: EvidenceDimensionDecisionSchema,
    featureVersion: z.literal('evidence-features-v1'),
    ruleVersion: z.literal('evidence-gate-v2'),
    calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    evaluatedAt: IsoDateTimeSchema,
  })
  .strict();

export const ForecastTimeBucketSchema = z.enum([
  'UNDER_30_MIN',
  '30_TO_60_MIN',
  '1_TO_2_HOURS',
  '2_TO_6_HOURS',
  '6_TO_24_HOURS',
]);

export const GeoCandidateFeaturesSchema = z
  .object({
    accountHistory: NormalisedSignalSchema,
    networkHistory: NormalisedSignalSchema,
    recency: NormalisedSignalSchema,
    timeSimilarity: NormalisedSignalSchema,
    amountSimilarity: NormalisedSignalSchema,
  })
  .strict();

export const GeoCandidateInputSchema = z
  .object({
    zoneId: IdentifierSchema,
    label: z.string().trim().min(1).max(120),
    features: GeoCandidateFeaturesSchema,
    provenance: AuthorisedPredictionProvenanceSchema,
  })
  .strict();

export const TimeHorizonFeaturesSchema = z
  .object({
    sameAccountDelayHistory: NormalisedSignalSchema,
    networkDelayHistory: NormalisedSignalSchema,
    amountSimilarity: NormalisedSignalSchema,
    velocityAlignment: NormalisedSignalSchema,
    temporalPattern: NormalisedSignalSchema,
    hopDepthSupport: NormalisedSignalSchema,
    similarCaseTiming: NormalisedSignalSchema,
  })
  .strict();

export const TimeHorizonInputSchema = z
  .object({
    bucket: ForecastTimeBucketSchema,
    features: TimeHorizonFeaturesSchema,
    provenance: AuthorisedPredictionProvenanceSchema,
  })
  .strict();

export const ForecastRunRequestSchema = z
  .object({
    accountId: IdentifierSchema,
    geoCandidates: z.array(GeoCandidateInputSchema).max(12).default([]),
    timeHorizons: z.array(TimeHorizonInputSchema).max(5).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const zoneIds = new Set(value.geoCandidates.map((candidate) => candidate.zoneId));
    if (zoneIds.size !== value.geoCandidates.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['geoCandidates'],
        message: 'Geo candidate zone IDs must be unique',
      });
    }

    const buckets = new Set(value.timeHorizons.map((horizon) => horizon.bucket));
    if (buckets.size !== value.timeHorizons.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeHorizons'],
        message: 'Time horizon buckets must be unique',
      });
    }
  });

const GeoRankedCandidateSchema = z
  .object({
    zoneId: IdentifierSchema,
    label: z.string().trim().min(1).max(120),
    probability: NormalisedSignalSchema,
    reasonCodes: z.array(IdentifierSchema).min(1),
    featureContributions: GeoCandidateFeaturesSchema,
  })
  .strict();

const GeoPredictionSchema = z
  .object({
    decision: z.literal('PREDICT'),
    candidates: z.array(GeoRankedCandidateSchema).min(1).max(3),
    otherProbability: NormalisedSignalSchema,
    confidence: NormalisedSignalSchema,
    modelVersion: z.literal('weighted-zone-ranker-v1'),
  })
  .strict()
  .superRefine((value, context) => {
    const zoneIds = new Set(value.candidates.map((candidate) => candidate.zoneId));
    if (zoneIds.size !== value.candidates.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates'],
        message: 'Ranked geo candidate zone IDs must be unique',
      });
    }
    const total =
      value.candidates.reduce((sum, candidate) => sum + candidate.probability, 0) +
      value.otherProbability;
    if (Math.abs(total - 1) > 0.002) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidates'],
        message: 'Geo candidate probabilities plus otherProbability must sum to 1',
      });
    }
  });

const GeoAbstentionSchema = z
  .object({
    decision: z.literal('ABSTAIN'),
    reasonCodes: z.array(IdentifierSchema).min(1),
  })
  .strict();

const RankedTimeHorizonSchema = z
  .object({
    bucket: ForecastTimeBucketSchema,
    probability: NormalisedSignalSchema,
    reasonCodes: z.array(IdentifierSchema).min(1),
    featureContributions: TimeHorizonFeaturesSchema,
  })
  .strict();

const TimePredictionSchema = z
  .object({
    decision: z.literal('PREDICT'),
    highestRiskBucket: ForecastTimeBucketSchema,
    horizons: z.array(RankedTimeHorizonSchema).length(5),
    confidence: NormalisedSignalSchema,
    modelVersion: z.literal('weighted-time-ranker-v1'),
  })
  .strict()
  .superRefine((value, context) => {
    const buckets = new Set(value.horizons.map((horizon) => horizon.bucket));
    if (buckets.size !== value.horizons.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['horizons'],
        message: 'Ranked time horizon buckets must be unique',
      });
    }
    const total = value.horizons.reduce((sum, horizon) => sum + horizon.probability, 0);
    if (Math.abs(total - 1) > 0.002) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['horizons'],
        message: 'Time horizon probabilities must sum to 1',
      });
    }
    if (value.horizons[0]?.bucket !== value.highestRiskBucket) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['highestRiskBucket'],
        message: 'highestRiskBucket must match the first ranked horizon',
      });
    }
  });

const TimeAbstentionSchema = z
  .object({
    decision: z.literal('ABSTAIN'),
    reasonCodes: z.array(IdentifierSchema).min(1),
  })
  .strict();

export const ForecastSnapshotSchema = z
  .object({
    predictionRunId: IdentifierSchema,
    previousPredictionRunId: IdentifierSchema.nullable(),
    evidenceGateRunId: IdentifierSchema,
    caseId: IdentifierSchema,
    accountId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    generatedAt: IsoDateTimeSchema,
    exitMode: z.enum(['STATIONARY', 'FORWARD', 'CASH_OUT_LIKELY']),
    evidenceGateDecision: z.enum(['PREDICT', 'PARTIAL', 'ABSTAIN']),
    geo: z.union([GeoPredictionSchema, GeoAbstentionSchema]),
    time: z.union([TimePredictionSchema, TimeAbstentionSchema]),
    featureVersion: z.literal('forecast-features-v1'),
    modelVersion: z.literal('deterministic-forecast-v1'),
    ruleVersion: z.literal('forecast-policy-v2'),
    calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    confidence: NormalisedSignalSchema,
    reasonCodes: z.array(IdentifierSchema).min(1),
  })
  .strict();

export const ExitModeRunResultSchema = z
  .object({ exitMode: ExitModeSnapshotSchema, replayed: z.boolean() })
  .strict();

export const EvidenceGateRunResultSchema = z
  .object({ evidenceGate: EvidenceGateSnapshotSchema, replayed: z.boolean() })
  .strict();

export const ForecastRunResultSchema = z
  .object({ forecast: ForecastSnapshotSchema, replayed: z.boolean() })
  .strict();

export type ExitModeProviderSignals = z.infer<typeof ExitModeProviderSignalsSchema>;
export type ExitModeRequest = z.infer<typeof ExitModeRequestSchema>;
export type ExitModeFeatureSnapshot = z.infer<typeof ExitModeFeatureSnapshotSchema>;
export type ExitModeSnapshot = z.infer<typeof ExitModeSnapshotSchema>;
export type EvidenceDimensionInput = z.infer<typeof EvidenceDimensionInputSchema>;
export type ForecastEvidenceRequest = z.infer<typeof ForecastEvidenceRequestSchema>;
export type EvidenceDimensionDecision = z.infer<typeof EvidenceDimensionDecisionSchema>;
export type EvidenceGateSnapshot = z.infer<typeof EvidenceGateSnapshotSchema>;
export type ForecastTimeBucket = z.infer<typeof ForecastTimeBucketSchema>;
export type GeoCandidateFeatures = z.infer<typeof GeoCandidateFeaturesSchema>;
export type GeoCandidateInput = z.infer<typeof GeoCandidateInputSchema>;
export type TimeHorizonFeatures = z.infer<typeof TimeHorizonFeaturesSchema>;
export type TimeHorizonInput = z.infer<typeof TimeHorizonInputSchema>;
export type ForecastRunRequest = z.infer<typeof ForecastRunRequestSchema>;
export type ForecastSnapshot = z.infer<typeof ForecastSnapshotSchema>;
