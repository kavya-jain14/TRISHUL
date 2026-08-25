import { z } from 'zod';
import { IdentifierSchema } from './common.js';
import { EvidenceAnchorRequestSchema } from './evidence-anchor.js';
import { ExposureRecomputeRequestSchema } from './exposure.js';
import {
  ExitModeRequestSchema,
  ForecastEvidenceRequestSchema,
  ForecastRunRequestSchema,
} from './forecast.js';
import { AccountRiskRequestSchema } from './risk.js';
import { IdempotencyKeySchema } from './trace.js';

export const TraceGraphExpansionJobSchema = z
  .object({
    caseId: IdentifierSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();

export const ExposureRecomputationJobSchema = z
  .object({
    caseId: IdentifierSchema,
    idempotencyKey: IdempotencyKeySchema,
    request: ExposureRecomputeRequestSchema,
  })
  .strict();

export const RiskReassessmentJobSchema = z
  .object({
    accountId: IdentifierSchema,
    idempotencyKey: IdempotencyKeySchema,
    request: AccountRiskRequestSchema,
  })
  .strict();

const ExitModeStepSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    request: ExitModeRequestSchema,
  })
  .strict();

const EvidenceGateStepSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    request: ForecastEvidenceRequestSchema,
  })
  .strict();

const ForecastRankingStepSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    request: ForecastRunRequestSchema,
  })
  .strict();

export const ForecastRefreshJobSchema = z
  .object({
    caseId: IdentifierSchema,
    exitMode: ExitModeStepSchema,
    evidenceGate: EvidenceGateStepSchema,
    forecast: ForecastRankingStepSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const accountIds = [
      value.exitMode.request.accountId,
      value.evidenceGate.request.accountId,
      value.forecast.request.accountId,
    ];
    if (new Set(accountIds).size !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forecast', 'request', 'accountId'],
        message: 'Every forecast-refresh step must target the same account',
      });
    }
  });

export const EvidenceAnchorJobSchema = z
  .object({
    caseId: IdentifierSchema,
    idempotencyKey: IdempotencyKeySchema,
    request: EvidenceAnchorRequestSchema,
  })
  .strict();

export type TraceGraphExpansionJob = z.infer<typeof TraceGraphExpansionJobSchema>;
export type ExposureRecomputationJob = z.infer<typeof ExposureRecomputationJobSchema>;
export type RiskReassessmentJob = z.infer<typeof RiskReassessmentJobSchema>;
export type ForecastRefreshJob = z.infer<typeof ForecastRefreshJobSchema>;
export type EvidenceAnchorJob = z.infer<typeof EvidenceAnchorJobSchema>;
