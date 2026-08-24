import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema, ProvenanceSchema } from './common.js';

const AuthorisedBalanceProvenanceSchema = ProvenanceSchema.refine(
  (value) => ['BANK', 'PSP', 'FI', 'SIMULATOR'].includes(value.sourceType),
  'Balance evidence must come from a bank, PSP, FI, or labelled simulator',
);

export const KnownCleanBalanceInputSchema = z
  .object({
    accountId: IdentifierSchema,
    knownCleanBalanceMinor: z.number().int().nonnegative(),
    provenance: AuthorisedBalanceProvenanceSchema,
  })
  .strict();

export const ExposureRecomputeRequestSchema = z
  .object({
    accountBalances: z.array(KnownCleanBalanceInputSchema).min(1).max(500),
  })
  .strict();

export const AccountExposureStateSchema = z
  .object({
    exposureStateId: IdentifierSchema,
    caseId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    accountId: IdentifierSchema,
    observedOutgoingMinor: z.number().int().nonnegative(),
    minimumFraudLinkedBalanceMinor: z.number().int().nonnegative(),
    fraudLinkedBalanceMinor: z.number().int().nonnegative(),
    knownCleanBalanceMinor: z.number().int().nonnegative(),
    nonFraudCompatibleInflowMinor: z.number().int().nonnegative(),
    balanceProvenance: AuthorisedBalanceProvenanceSchema,
    minimumAttributableMinor: z.number().int().nonnegative(),
    maximumAttributableMinor: z.number().int().nonnegative(),
    currency: z.literal('INR'),
    methodVersion: z.literal('exposure-range-v1'),
    calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    calculatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.minimumAttributableMinor > value.maximumAttributableMinor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minimumAttributableMinor'],
        message: 'Minimum attributable exposure cannot exceed maximum attributable exposure',
      });
    }
    if (value.minimumFraudLinkedBalanceMinor > value.fraudLinkedBalanceMinor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minimumFraudLinkedBalanceMinor'],
        message: 'Minimum fraud-linked balance cannot exceed its maximum',
      });
    }
    if (value.maximumAttributableMinor > value.observedOutgoingMinor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maximumAttributableMinor'],
        message: 'Maximum attributable exposure cannot exceed observed outgoing value',
      });
    }
  });

export const ExposureSnapshotSchema = z
  .object({
    snapshotId: IdentifierSchema,
    caseId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    calculationInputHash: z.string().regex(/^[a-f0-9]{64}$/),
    calculatedAt: IsoDateTimeSchema,
    states: z.array(AccountExposureStateSchema),
  })
  .strict();

export const ExposureRunResultSchema = z
  .object({
    exposure: ExposureSnapshotSchema,
    replayed: z.boolean(),
  })
  .strict();

export type KnownCleanBalanceInput = z.infer<typeof KnownCleanBalanceInputSchema>;
export type ExposureRecomputeRequest = z.infer<typeof ExposureRecomputeRequestSchema>;
export type AccountExposureState = z.infer<typeof AccountExposureStateSchema>;
export type ExposureSnapshot = z.infer<typeof ExposureSnapshotSchema>;
export type ExposureRunResult = z.infer<typeof ExposureRunResultSchema>;
