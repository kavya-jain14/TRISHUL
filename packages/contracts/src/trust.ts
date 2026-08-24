/**
 * Trust / Access / PrivacyPass contracts
 *
 * Zod schemas and inferred types for credential verification,
 * challenge-response flows, and access control verdicts.
 *
 * Owner: Vatsal Bhardwaj
 * Consumers: Ujjwal (frontend), Kavya (orchestration), all API routes
 */

import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Status of a verified credential */
export const CredentialStatusSchema = z.enum([
  "VERIFIED",
  "EXPIRED",
  "REVOKED",
  "INVALID",
]);
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;

/** Access control verdict after evaluating credential + capability request */
export const AccessVerdictSchema = z.enum([
  "AUTHORIZED",
  "DENIED",
  "PURPOSE_MISMATCH",
  "ROLE_INSUFFICIENT",
  "NONCE_INVALID",
  "REPLAY_DETECTED",
]);
export type AccessVerdict = z.infer<typeof AccessVerdictSchema>;

/** Investigator role classifications */
export const InvestigatorRoleSchema = z.enum([
  "CYBER_CELL_OFFICER",
  "FINANCIAL_INTELLIGENCE_ANALYST",
  "NODAL_OFFICER",
  "SUPERVISING_OFFICER",
  "BANK_COMPLIANCE_OFFICER",
  "SYSTEM_ADMIN",
]);
export type InvestigatorRole = z.infer<typeof InvestigatorRoleSchema>;

/** Purpose for which access is being requested */
export const AccessPurposeSchema = z.enum([
  "CASE_INVESTIGATION",
  "IDENTITY_RESOLUTION",
  "EVIDENCE_REVIEW",
  "INTERVENTION_ACTION",
  "INTELLIGENCE_EXPORT",
  "AUDIT_REVIEW",
  "SYSTEM_ADMINISTRATION",
]);
export type AccessPurpose = z.infer<typeof AccessPurposeSchema>;

/** Sensitive capabilities that require explicit authorization */
export const CapabilitySchema = z.enum([
  "IDENTITY_RESOLUTION",
  "BANK_ACCOUNT_DETAIL",
  "EVIDENCE_ACCESS",
  "INTERVENTION_CONTROL",
  "INTELLIGENCE_EXPORT",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

// ─── Credential ──────────────────────────────────────────────────────────────

/** A PrivacyPass-style credential issued to an investigator */
export const CredentialSchema = z.object({
  id: z.string().uuid(),
  /** Reference to the trusted issuer that created this credential */
  issuerRef: z.string().uuid(),
  /** Subject identifier (investigator user ID) */
  subjectId: z.string().uuid(),
  /** Role granted by this credential */
  role: InvestigatorRoleSchema,
  /** Purpose this credential is scoped to */
  purpose: AccessPurposeSchema,
  /** Credential validity window */
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
  /** Current verification status */
  status: CredentialStatusSchema,
  /** SHA-256 hash of the public key associated with this credential */
  publicKeyHash: z.string().min(64).max(128),
  /** Metadata for audit trail */
  issuedAt: z.string().datetime(),
});
export type Credential = z.infer<typeof CredentialSchema>;

// ─── Challenge / Response ────────────────────────────────────────────────────

/** Server-issued challenge for credential verification */
export const ChallengeRequestSchema = z.object({
  investigatorId: z.string().uuid(),
});
export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;

export const ChallengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  nonce: z.string().min(32),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;

/** Investigator's proof submitted in response to a challenge */
export const ChallengeProofSchema = z.object({
  challengeId: z.string().uuid(),
  nonce: z.string().min(32),
  credentialId: z.string().uuid(),
  /** Cryptographic signature proving possession of the private key */
  signature: z.string().min(1),
  /** The capability being requested */
  requestedCapability: CapabilitySchema,
  /** Optional case context for scoped access */
  caseId: z.string().uuid().optional(),
});
export type ChallengeProof = z.infer<typeof ChallengeProofSchema>;

// ─── Access Result ───────────────────────────────────────────────────────────

/** Result of an access evaluation */
export const AccessResultSchema = z.object({
  verdict: AccessVerdictSchema,
  /** Human-readable reason for the verdict */
  reason: z.string(),
  /** Granted capabilities (only populated if AUTHORIZED) */
  grantedCapabilities: z.array(CapabilitySchema),
  /** Session ID for the authorized session (only if AUTHORIZED) */
  sessionId: z.string().uuid().optional(),
  /** Timestamp of the evaluation */
  evaluatedAt: z.string().datetime(),
  /** Reference to the audit event for this evaluation */
  auditRef: z.string().uuid().optional(),
});
export type AccessResult = z.infer<typeof AccessResultSchema>;

// ─── Issuer ──────────────────────────────────────────────────────────────────

/** A trusted credential issuer */
export const IssuerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  /** Public key for verifying credentials issued by this issuer */
  publicKey: z.string().min(1),
  /** Whether this issuer is currently trusted */
  active: z.boolean(),
  registeredAt: z.string().datetime(),
});
export type Issuer = z.infer<typeof IssuerSchema>;
