/**
 * Audit contracts
 *
 * Schemas for the immutable audit trail.
 * Every sensitive operation (access attempt, identity resolution,
 * credential verification, intervention) generates an audit event.
 *
 * Owner: Vatsal Bhardwaj (trust/access audit events)
 * Consumers: Sandhya (case audit integration), Kavya (orchestration audit)
 *
 * NOTE: Secrets and raw credentials are NEVER stored in audit logs.
 */

import { z } from "zod";

/** Actions that generate audit events */
export const AuditActionSchema = z.enum([
  // Trust / Access
  "CHALLENGE_ISSUED",
  "CREDENTIAL_VERIFIED",
  "CREDENTIAL_REJECTED",
  "ACCESS_GRANTED",
  "ACCESS_DENIED",
  "NONCE_REPLAY_DETECTED",
  // Credential lifecycle
  "CREDENTIAL_REGISTERED",
  "CREDENTIAL_REVOKED",
  // Identity Resolution
  "IDENTITY_RESOLUTION_REQUESTED",
  "IDENTITY_RESOLUTION_AUTHORIZED",
  "IDENTITY_RESOLUTION_DENIED",
  "IDENTITY_RESOLUTION_COMPLETED",
  "IDENTITY_RESOLUTION_FAILED",
  // Evidence
  "EVIDENCE_HASH_ANCHORED",
  "EVIDENCE_INTEGRITY_VERIFIED",
  "EVIDENCE_INTEGRITY_FAILED",
  // Blockchain
  "BLOCKCHAIN_ANCHOR_CREATED",
  "BLOCKCHAIN_ANCHOR_VERIFIED",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/** Authorization result recorded in audit */
export const AuthorizationResultSchema = z.enum([
  "GRANTED",
  "DENIED",
  "NOT_APPLICABLE",
]);
export type AuthorizationResult = z.infer<typeof AuthorizationResultSchema>;

/** An immutable audit event */
export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  /** Who performed the action (investigator ID, system ID) */
  actor: z.string().min(1),
  /** What action was performed */
  action: AuditActionSchema,
  /** Associated case ID (if applicable) */
  caseId: z.string().uuid().optional(),
  /** When the event occurred */
  timestamp: z.string().datetime(),
  /** Result of authorization check for this action */
  authorizationResult: AuthorizationResultSchema,
  /** Reference to the credential used (ID only, not the credential itself) */
  credentialRef: z.string().uuid().optional(),
  /** Reference to the verification session */
  sessionRef: z.string().uuid().optional(),
  /** Declared purpose of the action */
  purpose: z.string().optional(),
  /** Outcome description */
  outcome: z.string().min(1),
  /** Reference to evidence hash if applicable */
  evidenceHashRef: z.string().optional(),
  /** On-chain anchor reference if this event was anchored */
  blockchainAnchorRef: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** Query parameters for retrieving audit events */
export const AuditQuerySchema = z.object({
  caseId: z.string().uuid().optional(),
  actor: z.string().optional(),
  action: AuditActionSchema.optional(),
  fromTimestamp: z.string().datetime().optional(),
  toTimestamp: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
