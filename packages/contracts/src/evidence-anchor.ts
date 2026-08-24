import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

export const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const EvidenceAnchorRequestSchema = z
  .object({
    evidenceRef: IdentifierSchema,
    evidence: z.record(z.unknown()),
  })
  .strict();

export const EvidenceAnchorReceiptSchema = z
  .object({
    anchorId: IdentifierSchema,
    caseId: IdentifierSchema,
    evidenceRef: IdentifierSchema,
    evidenceHash: Sha256DigestSchema,
    submissionHash: Sha256DigestSchema,
    provider: z.string().trim().min(1).max(128),
    network: z.string().trim().min(1).max(128),
    anchorReference: IdentifierSchema,
    transactionHash: Sha256DigestSchema,
    anchoredAt: IsoDateTimeSchema,
  })
  .strict();

export const EvidenceVerificationRequestSchema = z
  .object({
    evidence: z.record(z.unknown()),
  })
  .strict();

export const EvidenceVerificationResultSchema = z
  .object({
    anchorId: IdentifierSchema,
    evidenceHash: Sha256DigestSchema,
    suppliedEvidenceHash: Sha256DigestSchema,
    payloadHashMatches: z.boolean(),
    ledgerReceiptValid: z.boolean(),
    verified: z.boolean(),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export type EvidenceAnchorRequest = z.infer<typeof EvidenceAnchorRequestSchema>;
export type EvidenceAnchorReceipt = z.infer<typeof EvidenceAnchorReceiptSchema>;
export type EvidenceVerificationResult = z.infer<typeof EvidenceVerificationResultSchema>;
