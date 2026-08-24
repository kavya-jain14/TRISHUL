/**
 * Blockchain / Credential Registry contracts
 *
 * Schemas for blockchain-anchored data. TRISHUL uses blockchain ONLY for:
 * - Credential registry (issuer refs, validity, revocation)
 * - Cryptographic hashes of evidence
 * - Critical investigation/audit anchors
 * - Later verification that off-chain evidence has not been mutated
 *
 * Blockchain is NOT used for:
 * - Tracing UPI/bank transfers
 * - Revealing beneficiary KYC
 * - Storing raw sensitive identity data
 * - Detecting mule accounts
 * - Predicting cash-out locations/times
 *
 * Owner: Vatsal Bhardwaj (credential registry, evidence anchors)
 * Integration: Fuzail (blockchain anchor service backend)
 */

import { z } from "zod";

/** An on-chain credential registry entry */
export const CredentialRegistryEntrySchema = z.object({
  /** SHA-256 hash of the credential */
  credentialHash: z.string().min(64),
  /** Reference to the issuer on-chain */
  issuerRef: z.string().min(1),
  /** Current status on-chain */
  status: z.enum(["ACTIVE", "REVOKED"]),
  /** When this entry was anchored on-chain */
  anchorTimestamp: z.string().datetime(),
  /** On-chain transaction reference */
  txRef: z.string().min(1),
});
export type CredentialRegistryEntry = z.infer<typeof CredentialRegistryEntrySchema>;

/** An on-chain evidence hash anchor */
export const EvidenceAnchorSchema = z.object({
  /** SHA-256 hash of the evidence data */
  evidenceHash: z.string().min(64),
  /** Case this evidence belongs to */
  caseId: z.string().uuid(),
  /** When the anchor was created */
  anchorTimestamp: z.string().datetime(),
  /** On-chain transaction reference */
  txRef: z.string().min(1),
});
export type EvidenceAnchor = z.infer<typeof EvidenceAnchorSchema>;

/** An on-chain audit anchor */
export const AuditAnchorSchema = z.object({
  /** SHA-256 hash of the audit event */
  auditEventHash: z.string().min(64),
  /** Reference to the audit event */
  auditEventId: z.string().uuid(),
  /** When the anchor was created */
  anchorTimestamp: z.string().datetime(),
  /** On-chain transaction reference */
  txRef: z.string().min(1),
});
export type AuditAnchor = z.infer<typeof AuditAnchorSchema>;

/**
 * Interface for blockchain anchor service.
 * The prototype uses an in-memory simulator.
 * Fuzail's production anchor service should implement this interface.
 */
export const BlockchainAnchorRequestSchema = z.object({
  hash: z.string().min(64),
  metadata: z.record(z.string()),
});
export type BlockchainAnchorRequest = z.infer<typeof BlockchainAnchorRequestSchema>;

export const BlockchainAnchorResultSchema = z.object({
  txRef: z.string().min(1),
  anchorTimestamp: z.string().datetime(),
  verified: z.boolean(),
});
export type BlockchainAnchorResult = z.infer<typeof BlockchainAnchorResultSchema>;
