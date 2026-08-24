import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema, MoneySchema } from './common.js';
import { CaseStateSchema } from './state-machine.js';

export const ComplaintSourceSchema = z.enum(['VICTIM', 'BANK', 'PSP', 'LEA', 'NCRP_IMPORT']);

export const ComplaintCreateSchema = z
  .object({
    idempotencyKey: IdentifierSchema,
    complaintId: IdentifierSchema,
    originalTransactionRef: IdentifierSchema,
    reportedAmount: MoneySchema,
    transactionOccurredAt: IsoDateTimeSchema,
    reportedAt: IsoDateTimeSchema,
    payerReference: IdentifierSchema.optional(),
    beneficiaryReference: IdentifierSchema.optional(),
    category: z.string().trim().min(1).max(80),
    source: ComplaintSourceSchema,
    evidenceReferences: z.array(IdentifierSchema).max(20).default([]),
  })
  .strict();

export const CaseSummarySchema = z
  .object({
    caseId: IdentifierSchema,
    complaintId: IdentifierSchema,
    state: CaseStateSchema,
    originalTransactionRef: IdentifierSchema,
    graphVersion: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type ComplaintCreate = z.infer<typeof ComplaintCreateSchema>;
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
