import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

export const IdentityResolutionStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'FAILED']);

export const IdentityResolutionDecisionSchema = z.enum(['APPROVE', 'REJECT']);

export const IdentityResolutionRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    caseId: IdentifierSchema,
    investigatorId: IdentifierSchema,
    requestJustification: z.string().trim().min(12).max(2_000),
    status: IdentityResolutionStatusSchema,
    decidedBy: IdentifierSchema.optional(),
    decisionJustification: z.string().trim().min(12).max(2_000).optional(),
    providerReference: IdentifierSchema.optional(),
    requestedAt: IsoDateTimeSchema,
    resolvedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const IdentityResolutionCreateRequestSchema = z
  .object({
    justification: z.string().trim().min(12).max(2_000),
  })
  .strict();

export const IdentityResolutionApprovalSchema = z
  .object({
    decision: IdentityResolutionDecisionSchema,
    justification: z.string().trim().min(12).max(2_000),
  })
  .strict();

export const IdentityResolutionResultSchema = z
  .object({
    requestId: z.string().uuid(),
    caseId: IdentifierSchema,
    status: IdentityResolutionStatusSchema,
    providerReference: IdentifierSchema.optional(),
    resolvedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export type IdentityResolutionStatus = z.infer<typeof IdentityResolutionStatusSchema>;
export type IdentityResolutionDecision = z.infer<typeof IdentityResolutionDecisionSchema>;
export type IdentityResolutionRequest = z.infer<typeof IdentityResolutionRequestSchema>;
export type IdentityResolutionCreateRequest = z.infer<typeof IdentityResolutionCreateRequestSchema>;
export type IdentityResolutionApproval = z.infer<typeof IdentityResolutionApprovalSchema>;
export type IdentityResolutionResult = z.infer<typeof IdentityResolutionResultSchema>;
