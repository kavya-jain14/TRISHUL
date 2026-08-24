import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

export const RiskBandSchema = z.enum(['LOW', 'MODERATE', 'ELEVATED', 'HIGH']);
export const RiskDecisionSchema = z.enum(['ALLOW', 'WARN', 'STEP_UP', 'PARTNER_BLOCK']);
export const MuleRiskStateSchema = z.enum([
  'NORMAL',
  'ANOMALOUS',
  'WATCH',
  'SUSPECTED_MULE',
  'CONFIRMED',
]);

const RiskDimensionSchema = z
  .object({
    score: z.number().min(0).max(100),
    band: RiskBandSchema,
    reasonCodes: z.array(IdentifierSchema),
  })
  .strict();

export const RiskAssessmentSchema = z
  .object({
    assessmentId: IdentifierSchema,
    subjectReference: IdentifierSchema,
    evaluatedAt: IsoDateTimeSchema,
    trustStatus: z.enum(['NOT_PRESENTED', 'VERIFIED', 'INVALID', 'REVOKED']),
    transactionAnomaly: RiskDimensionSchema,
    receiverBehaviour: RiskDimensionSchema,
    networkRisk: RiskDimensionSchema,
    muleState: MuleRiskStateSchema,
    decision: RiskDecisionSchema,
    reasonCodes: z.array(IdentifierSchema),
    ruleVersion: IdentifierSchema,
    featureVersion: IdentifierSchema,
  })
  .strict();

export type MuleRiskState = z.infer<typeof MuleRiskStateSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
