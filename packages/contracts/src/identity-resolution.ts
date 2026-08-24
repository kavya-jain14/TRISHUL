/**
 * Identity Resolution contracts
 *
 * Schemas for the lawful identity-resolution workflow.
 * Identity resolution follows strict authorization requirements:
 * 1. An active reported case must exist
 * 2. Investigator must prove valid role/purpose credential
 * 3. TRISHUL coordinates with regulated institution (off-chain)
 * 4. Only permitted identity information is returned
 * 5. Every request is audited
 *
 * IMPORTANT: Blockchain does NOT reveal KYC identity.
 * The regulated bank/issuer owns the authoritative account-to-KYC mapping.
 *
 * Owner: Vatsal Bhardwaj
 * Consumers: Sandhya (case integration), Ujjwal (frontend)
 */

import { z } from "zod";

/** Status of an identity resolution request */
export const IdentityResolutionStatusSchema = z.enum([
  "REQUESTED",
  "AUTHORIZING",
  "RESOLVED",
  "DENIED",
  "FAILED",
]);
export type IdentityResolutionStatus = z.infer<typeof IdentityResolutionStatusSchema>;

/** Request to initiate identity resolution (case-bound) */
export const IdentityResolutionRequestSchema = z.object({
  /** The active case this resolution is bound to */
  caseId: z.string().uuid(),
  /** The account reference to resolve (e.g., UPI VPA, bank account hash) */
  accountRef: z.string().min(1),
  /** The investigator's credential ID authorizing this request */
  investigatorCredentialId: z.string().uuid(),
  /** Purpose for the resolution — must match credential purpose */
  purpose: z.literal("IDENTITY_RESOLUTION"),
  /** Challenge nonce proving freshness */
  challengeNonce: z.string().min(32),
});
export type IdentityResolutionRequest = z.infer<typeof IdentityResolutionRequestSchema>;

/**
 * Redacted identity information returned from resolution.
 * Only the minimum required for the investigation is included.
 * Raw KYC data is NEVER stored in TRISHUL or blockchain.
 */
export const RedactedIdentityInfoSchema = z.object({
  /** Masked account holder name (e.g., "V***l B***j") */
  maskedName: z.string().optional(),
  /** Masked account identifier */
  maskedAccountId: z.string().optional(),
  /** Institution that performed the lookup */
  resolvingInstitution: z.string().min(1),
  /** Timestamp of resolution at the institution */
  resolvedAt: z.string().datetime(),
  /** Indicates whether the institution confirmed account-holder match */
  accountHolderConfirmed: z.boolean(),
});
export type RedactedIdentityInfo = z.infer<typeof RedactedIdentityInfoSchema>;

/** Result of an identity resolution request */
export const IdentityResolutionResultSchema = z.object({
  requestId: z.string().uuid(),
  status: IdentityResolutionStatusSchema,
  /** Redacted identity info (only present when status is RESOLVED) */
  redactedInfo: RedactedIdentityInfoSchema.optional(),
  /** Reason for denial/failure (only present when status is DENIED or FAILED) */
  reason: z.string().optional(),
  /** Reference to the audit event for this resolution */
  auditRef: z.string().uuid(),
  /** Timestamp */
  processedAt: z.string().datetime(),
});
export type IdentityResolutionResult = z.infer<typeof IdentityResolutionResultSchema>;
