import { z } from 'zod';
import { AlertJobPayloadSchema } from './alerts.js';
import { CaseSummarySchema } from './cases.js';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';
import { ForecastTimeBucketSchema } from './forecast.js';

export const OperationalStateSchema = z.enum([
  'ACTIVE_INTERVENTION_WINDOW',
  'ELEVATED_HORIZON',
  'MONITORING',
  'CASH_OUT_MAY_HAVE_OCCURRED',
  'OUTCOME_KNOWN',
]);

export const CasePriorityBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const RecommendedActionSchema = z.enum([
  'MONITOR_CASE',
  'PREPARE_ESCALATION',
  'ESCALATE_PRIORITY',
  'ALERT_BANK',
  'ALERT_LEA',
  'GENERATE_INTELLIGENCE_PACKET',
  'RECONSTRUCT_AND_LEARN',
  'RECORD_OUTCOME',
]);

export const CommandCenterExitModeSchema = z.enum([
  'STATIONARY',
  'FORWARD',
  'CASH_OUT_LIKELY',
  'NOT_ASSESSED',
]);

export const CommandCenterEvidenceDecisionSchema = z.enum([
  'PREDICT',
  'PARTIAL',
  'ABSTAIN',
  'NOT_ASSESSED',
]);

export const InstitutionalOutcomeSchema = z.enum([
  'NONE',
  'UNRESOLVED',
  'SUSPECTED',
  'CONFIRMED',
  'CLEARED',
]);

export const CasePriorityFeaturesSchema = z
  .object({
    reportedAmountMinor: z.number().int().nonnegative(),
    maximumAttributableMinor: z.number().int().nonnegative(),
    highestMuleRiskScore: z.number().min(0).max(100),
    crossCaseLinkage: z.number().min(0).max(1),
    exitMode: CommandCenterExitModeSchema,
    evidenceGateDecision: CommandCenterEvidenceDecisionSchema,
    highestRiskTimeBucket: ForecastTimeBucketSchema.nullable(),
    forecastConfidence: z.number().min(0).max(1),
    observedCashOut: z.boolean(),
    institutionalOutcome: InstitutionalOutcomeSchema,
    complaintLagMinutes: z.number().int().nonnegative(),
  })
  .strict();

export const CasePriorityDecisionSchema = z
  .object({
    priorityScore: z.number().int().min(0).max(100),
    priorityBand: CasePriorityBandSchema,
    operationalState: OperationalStateSchema,
    reasonCodes: z.array(IdentifierSchema).min(1),
    recommendedActions: z.array(RecommendedActionSchema),
  })
  .strict();

export const CasePrioritySnapshotSchema = CasePriorityDecisionSchema.extend({
  priorityRunId: IdentifierSchema,
  caseId: IdentifierSchema,
  graphVersion: z.number().int().nonnegative(),
  features: CasePriorityFeaturesSchema,
  featureVersion: z.literal('case-priority-features-v1'),
  ruleVersion: z.literal('case-priority-v1'),
  calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
  calculatedAt: IsoDateTimeSchema,
}).strict();

export const AlertLifecycleStatusSchema = z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']);

export const CommandCenterAlertSchema = AlertJobPayloadSchema.extend({
  priorityRunId: IdentifierSchema,
  deduplicationKey: z.string().trim().min(1).max(512),
  reasonCodes: z.array(IdentifierSchema),
  recommendedActions: z.array(RecommendedActionSchema),
  status: AlertLifecycleStatusSchema,
  acknowledgedAt: IsoDateTimeSchema.nullable(),
  acknowledgedBy: IdentifierSchema.nullable(),
  acknowledgementRationale: z.string().trim().min(1).max(1_000).nullable(),
  resolvedAt: IsoDateTimeSchema.nullable(),
  resolvedBy: IdentifierSchema.nullable(),
  resolutionRationale: z.string().trim().min(1).max(1_000).nullable(),
}).strict();

export const AlertLifecycleUpdateRequestSchema = z
  .object({
    rationale: z.string().trim().min(10).max(1_000),
  })
  .strict();

export const CommandCenterCaseItemSchema = z
  .object({
    summary: CaseSummarySchema,
    reportedAmountMinor: z.number().int().nonnegative(),
    priority: CasePrioritySnapshotSchema.nullable(),
    openAlertCount: z.number().int().nonnegative(),
    latestAlert: CommandCenterAlertSchema.nullable(),
  })
  .strict();

export const CommandCenterSnapshotSchema = z
  .object({
    generatedAt: IsoDateTimeSchema,
    scopeCaseIds: z.array(IdentifierSchema),
    counts: z
      .object({
        totalCases: z.number().int().nonnegative(),
        activeInterventionWindows: z.number().int().nonnegative(),
        openAlerts: z.number().int().nonnegative(),
        abstainingCases: z.number().int().nonnegative(),
      })
      .strict(),
    cases: z.array(CommandCenterCaseItemSchema),
    ruleVersion: z.literal('case-priority-v1'),
  })
  .strict();

export type OperationalState = z.infer<typeof OperationalStateSchema>;
export type CasePriorityBand = z.infer<typeof CasePriorityBandSchema>;
export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;
export type InstitutionalOutcome = z.infer<typeof InstitutionalOutcomeSchema>;
export type CasePriorityFeatures = z.infer<typeof CasePriorityFeaturesSchema>;
export type CasePriorityDecision = z.infer<typeof CasePriorityDecisionSchema>;
export type CasePrioritySnapshot = z.infer<typeof CasePrioritySnapshotSchema>;
export type AlertLifecycleStatus = z.infer<typeof AlertLifecycleStatusSchema>;
export type CommandCenterAlert = z.infer<typeof CommandCenterAlertSchema>;
export type CommandCenterCaseItem = z.infer<typeof CommandCenterCaseItemSchema>;
export type CommandCenterSnapshot = z.infer<typeof CommandCenterSnapshotSchema>;
