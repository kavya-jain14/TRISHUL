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

const GeoPredictionSchema = z
  .object({
    decision: z.literal('PREDICT'),
    candidates: z
      .array(
        z
          .object({
            zoneId: IdentifierSchema,
            label: z.string().trim().min(1).max(120),
            probability: z.number().min(0).max(1),
            reasonCodes: z.array(IdentifierSchema),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

const GeoAbstentionSchema = z
  .object({
    decision: z.literal('ABSTAIN'),
    reasonCodes: z.array(IdentifierSchema).min(1),
  })
  .strict();

const TimePredictionSchema = z
  .object({
    decision: z.literal('PREDICT'),
    horizons: z
      .array(
        z
          .object({
            bucket: z.enum([
              'UNDER_30_MIN',
              '30_TO_60_MIN',
              '1_TO_2_HOURS',
              '2_TO_6_HOURS',
              'OVER_6_HOURS',
            ]),
            probability: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const TimeAbstentionSchema = z
  .object({
    decision: z.literal('ABSTAIN'),
    reasonCodes: z.array(IdentifierSchema).min(1),
  })
  .strict();

export const ForecastSnapshotSchema = z
  .object({
    predictionRunId: IdentifierSchema,
    caseId: IdentifierSchema,
    generatedAt: IsoDateTimeSchema,
    exitMode: ExitModeSchema,
    evidenceGate: EvidenceGateResultSchema,
    geo: z.discriminatedUnion('decision', [GeoPredictionSchema, GeoAbstentionSchema]),
    time: z.discriminatedUnion('decision', [TimePredictionSchema, TimeAbstentionSchema]),
    graphVersion: z.number().int().positive(),
    featureVersion: IdentifierSchema,
    modelVersion: IdentifierSchema,
    ruleVersion: IdentifierSchema,
    confidence: z.number().min(0).max(1),
    reasonCodes: z.array(IdentifierSchema),
  })
  .strict();

export type EvidenceGateResult = z.infer<typeof EvidenceGateResultSchema>;
export type ForecastSnapshot = z.infer<typeof ForecastSnapshotSchema>;

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

export const ExitModeRunResultSchema = z
  .object({ exitMode: ExitModeSnapshotSchema, replayed: z.boolean() })
  .strict();

export const EvidenceGateRunResultSchema = z
  .object({ evidenceGate: EvidenceGateSnapshotSchema, replayed: z.boolean() })
  .strict();

export type ExitModeProviderSignals = z.infer<typeof ExitModeProviderSignalsSchema>;
export type ExitModeRequest = z.infer<typeof ExitModeRequestSchema>;
export type ExitModeFeatureSnapshot = z.infer<typeof ExitModeFeatureSnapshotSchema>;
export type ExitModeSnapshot = z.infer<typeof ExitModeSnapshotSchema>;
export type EvidenceDimensionInput = z.infer<typeof EvidenceDimensionInputSchema>;
export type ForecastEvidenceRequest = z.infer<typeof ForecastEvidenceRequestSchema>;
export type EvidenceDimensionDecision = z.infer<typeof EvidenceDimensionDecisionSchema>;
export type EvidenceGateSnapshot = z.infer<typeof EvidenceGateSnapshotSchema>;
