import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

export const IdentityResolutionStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'FAILED'
]);

export const IdentityResolutionRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    caseId: IdentifierSchema,
    investigatorId: IdentifierSchema,
    status: IdentityResolutionStatusSchema,
    supervisorId: IdentifierSchema.optional(),
    providerReference: z.string().optional(),
    requestedAt: IsoDateTimeSchema,
    resolvedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const IdentityResolutionCreateRequestSchema = z
  .object({
    caseId: IdentifierSchema,
  })
  .strict();

export const IdentityResolutionApprovalSchema = z
  .object({
    approved: z.boolean(),
  })
  .strict();

export const IdentityResolutionResultSchema = z
  .object({
    requestId: z.string().uuid(),
    status: IdentityResolutionStatusSchema,
    pii: z.object({
      name: z.string(),
      address: z.string(),
      nationalId: z.string(),
    }).optional(),
  })
  .strict();

export type IdentityResolutionStatus = z.infer<typeof IdentityResolutionStatusSchema>;
export type IdentityResolutionRequest = z.infer<typeof IdentityResolutionRequestSchema>;
export type IdentityResolutionCreateRequest = z.infer<typeof IdentityResolutionCreateRequestSchema>;
export type IdentityResolutionApproval = z.infer<typeof IdentityResolutionApprovalSchema>;
export type IdentityResolutionResult = z.infer<typeof IdentityResolutionResultSchema>;
