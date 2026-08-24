import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

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
