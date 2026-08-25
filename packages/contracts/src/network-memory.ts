import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';
import { GraphSnapshotSchema } from './graph.js';
import { AuthorisedSignalProvenanceSchema } from './risk.js';

export const TrustedHistoricalOutcomeProvenanceSchema = AuthorisedSignalProvenanceSchema.refine(
  (value) =>
    value.sourceType === 'SIMULATOR'
      ? value.evidenceState === 'SIMULATED'
      : value.evidenceState === 'VERIFIED',
  'Institutional outcomes must be verified or explicitly labelled simulator evidence',
);

export const HistoricalInstitutionalOutcomeStatusSchema = z.enum([
  'NO_INSTITUTIONAL_OUTCOME',
  'SUSPECTED',
  'CONFIRMED',
  'CLEARED',
]);

export const HistoricalInstitutionalOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('NO_INSTITUTIONAL_OUTCOME') }).strict(),
  z
    .object({
      status: z.literal('SUSPECTED'),
      provenance: TrustedHistoricalOutcomeProvenanceSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('CONFIRMED'),
      provenance: TrustedHistoricalOutcomeProvenanceSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('CLEARED'),
      provenance: TrustedHistoricalOutcomeProvenanceSchema,
    })
    .strict(),
]);

/** Internal calculation evidence. Public correlation results never expose caseId. */
export const HistoricalCaseEvidenceSchema = z
  .object({
    caseId: IdentifierSchema,
    graph: GraphSnapshotSchema,
    outcome: HistoricalInstitutionalOutcomeSchema,
  })
  .strict();

export const CrossCaseMatchSchema = z
  .object({
    matchReference: IdentifierSchema,
    historicalGraphVersion: z.number().int().positive(),
    outcomeStatus: HistoricalInstitutionalOutcomeStatusSchema,
    directAccountReuse: z.boolean(),
    sharedDownstreamAccountCount: z.number().int().nonnegative(),
    sharedEdgeCount: z.number().int().nonnegative(),
    evidenceWeight: z.number().min(0).max(1),
    reasonCodes: z.array(IdentifierSchema),
  })
  .strict();

export const AccountCorrelationSignalSchema = z
  .object({
    accountId: IdentifierSchema,
    crossCaseLinkage: z.number().min(0).max(1),
    matchedCaseCount: z.number().int().nonnegative(),
    confirmedOutcomeCaseCount: z.number().int().nonnegative(),
    suspectedOutcomeCaseCount: z.number().int().nonnegative(),
    clearedOutcomeCaseCount: z.number().int().nonnegative(),
    sharedDownstreamAccountIds: z.array(IdentifierSchema),
    reasonCodes: z.array(IdentifierSchema),
    matches: z.array(CrossCaseMatchSchema),
  })
  .strict();

export const CrossCaseCorrelationSnapshotSchema = z
  .object({
    correlationRunId: IdentifierSchema,
    caseId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    evaluatedAt: IsoDateTimeSchema,
    accountSignals: z.array(AccountCorrelationSignalSchema),
    ruleVersion: z.literal('cross-case-correlation-v1'),
    calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const CrossCaseCorrelationRunResultSchema = z
  .object({
    correlation: CrossCaseCorrelationSnapshotSchema,
    replayed: z.boolean(),
  })
  .strict();

export type HistoricalInstitutionalOutcome = z.infer<typeof HistoricalInstitutionalOutcomeSchema>;
export type HistoricalCaseEvidence = z.infer<typeof HistoricalCaseEvidenceSchema>;
export type CrossCaseMatch = z.infer<typeof CrossCaseMatchSchema>;
export type AccountCorrelationSignal = z.infer<typeof AccountCorrelationSignalSchema>;
export type CrossCaseCorrelationSnapshot = z.infer<typeof CrossCaseCorrelationSnapshotSchema>;
export type CrossCaseCorrelationRunResult = z.infer<typeof CrossCaseCorrelationRunResultSchema>;
