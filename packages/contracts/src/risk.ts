import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema, ProvenanceSchema } from './common.js';

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

const NormalisedSignalSchema = z.number().min(0).max(1);

const AuthorisedSignalProvenanceSchema = ProvenanceSchema.refine(
  (value) => ['BANK', 'PSP', 'FI', 'SIMULATOR'].includes(value.sourceType),
  'Risk signals must come from a bank, PSP, FI, or labelled simulator',
);

export const ProviderRiskSignalsSchema = z
  .object({
    inflowSpike: NormalisedSignalSchema,
    uniqueSenderSpike: NormalisedSignalSchema,
    firstTimeSenderRatio: NormalisedSignalSchema,
    behaviourShift: NormalisedSignalSchema,
    crossCaseLinkage: NormalisedSignalSchema,
    authorisedSharedIdentifierStrength: NormalisedSignalSchema,
    provenance: AuthorisedSignalProvenanceSchema,
  })
  .strict();

export const TrustedOutcomeInputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('NONE') }).strict(),
  z
    .object({
      status: z.literal('CONFIRMED'),
      institutionalReference: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('CLEARED'),
      institutionalReference: IdentifierSchema,
    })
    .strict(),
]);

export const AccountRiskRequestSchema = z
  .object({
    caseId: IdentifierSchema,
    providerSignals: ProviderRiskSignalsSchema,
    trustedOutcome: TrustedOutcomeInputSchema,
  })
  .strict();

export const MuleFeatureSnapshotSchema = z
  .object({
    behaviour: z
      .object({
        inflowSpike: NormalisedSignalSchema,
        uniqueSenderSpike: NormalisedSignalSchema,
        firstTimeSenderRatio: NormalisedSignalSchema,
        fanIn: NormalisedSignalSchema,
        fanOut: NormalisedSignalSchema,
        passThrough: NormalisedSignalSchema,
        balanceDrain: NormalisedSignalSchema,
        behaviourShift: NormalisedSignalSchema,
      })
      .strict(),
    network: z
      .object({
        reportedNetworkProximity: NormalisedSignalSchema,
        repeatedConvergence: NormalisedSignalSchema,
        crossCaseLinkage: NormalisedSignalSchema,
      })
      .strict(),
    movement: z
      .object({
        rapidForwarding: NormalisedSignalSchema,
        splitting: NormalisedSignalSchema,
        cashOutTendency: NormalisedSignalSchema,
      })
      .strict(),
    entityLinkage: z
      .object({
        authorisedSharedIdentifierStrength: NormalisedSignalSchema,
      })
      .strict(),
  })
  .strict();

export const MuleAssessmentSnapshotSchema = z
  .object({
    assessmentId: IdentifierSchema,
    caseId: IdentifierSchema,
    accountId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    state: MuleRiskStateSchema,
    score: z.number().min(0).max(100),
    reasonCodes: z.array(IdentifierSchema),
    features: MuleFeatureSnapshotSchema,
    featureVersion: z.literal('mule-features-v1'),
    ruleVersion: z.literal('mule-risk-v1'),
    calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    signalProvenance: AuthorisedSignalProvenanceSchema,
    trustedOutcome: TrustedOutcomeInputSchema,
    assessedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === 'CONFIRMED' && value.trustedOutcome.status !== 'CONFIRMED') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['state'],
        message: 'CONFIRMED is reserved for a trusted institutional outcome',
      });
    }
  });

export const MuleAssessmentRunResultSchema = z
  .object({
    assessment: MuleAssessmentSnapshotSchema,
    replayed: z.boolean(),
  })
  .strict();

export const CaseRiskSnapshotsSchema = z
  .object({
    caseId: IdentifierSchema,
    assessments: z.array(MuleAssessmentSnapshotSchema),
  })
  .strict();

export type AccountRiskRequest = z.infer<typeof AccountRiskRequestSchema>;
export type ProviderRiskSignals = z.infer<typeof ProviderRiskSignalsSchema>;
export type MuleFeatureSnapshot = z.infer<typeof MuleFeatureSnapshotSchema>;
export type MuleAssessmentSnapshot = z.infer<typeof MuleAssessmentSnapshotSchema>;
export type MuleAssessmentRunResult = z.infer<typeof MuleAssessmentRunResultSchema>;
