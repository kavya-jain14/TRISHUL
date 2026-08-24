/**
 * Internal types for the trust engine.
 * Types that are shared across frontend/backend belong in @trishul/contracts.
 * These types are implementation-internal.
 */

import type {
  Credential,
  CredentialStatus,
  AccessVerdict,
  Capability,
  Issuer,
  AuditEvent,
} from "@trishul/contracts";

/** Context for credential verification */
export interface VerificationContext {
  /** The credential to verify */
  credential: Credential;
  /** Current timestamp for validity checks */
  now: Date;
}

/** Context for access evaluation */
export interface AccessEvaluationContext {
  /** Verified credential (post-verification) */
  credential: Credential;
  /** Capability being requested */
  requestedCapability: Capability;
  /** Case context if the request is case-bound */
  caseContext?: CaseContext;
}

/** Case context for case-bound operations */
export interface CaseContext {
  /** Active case ID */
  caseId: string;
  /** Whether the case is currently active */
  isActive: boolean;
  /** Account references associated with this case */
  accountRefs: string[];
}

/** Context for identity resolution */
export interface IdentityResolutionContext {
  caseId: string;
  accountRef: string;
  investigatorCredential: Credential;
  challengeNonce: string;
}

/**
 * Interface for the blockchain anchor service.
 *
 * The prototype uses an in-memory simulator (see @trishul/audit).
 * Fuzail's production anchor service should implement this interface
 * to replace the simulator with a real blockchain backend.
 */
export interface BlockchainAnchorService {
  /**
   * Anchor a hash on-chain.
   * @param hash - SHA-256 hash to anchor
   * @param metadata - Additional metadata to associate with the anchor
   * @returns Transaction reference and timestamp
   */
  anchor(
    hash: string,
    metadata: Record<string, string>
  ): Promise<{ txRef: string; anchorTimestamp: string }>;

  /**
   * Verify that a hash was previously anchored on-chain.
   * @param txRef - Transaction reference from the anchor operation
   * @param expectedHash - The hash that should be anchored at this txRef
   * @returns Whether the hash matches the on-chain record
   */
  verify(txRef: string, expectedHash: string): Promise<boolean>;
}

/** Issuer registry for looking up trusted issuers */
export interface IssuerRegistry {
  /** Get an issuer by ID */
  getIssuer(issuerId: string): Promise<Issuer | null>;
  /** Check if an issuer is currently trusted/active */
  isIssuerActive(issuerId: string): Promise<boolean>;
}

/** Revocation registry for checking credential revocation status */
export interface RevocationRegistry {
  /** Check if a credential has been revoked */
  isRevoked(credentialId: string): Promise<boolean>;
  /** Get the revocation reason if revoked */
  getRevocationReason(credentialId: string): Promise<string | null>;
}

/** Case service interface — Sandhya's case module should implement this */
export interface CaseService {
  /** Check if a case exists and is active */
  getCaseContext(caseId: string): Promise<CaseContext | null>;
}

/** Audit service interface */
export interface AuditService {
  /** Record an audit event */
  record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<string>;
}

/**
 * Simulated bank/issuer KYC lookup service.
 * In production, this would be a secure off-chain API call to the regulated institution.
 * The simulator returns deterministic test data and is clearly labeled.
 */
export interface BankKycLookupService {
  /**
   * Request identity resolution from a regulated institution.
   * [SIMULATOR] In prototype, returns deterministic masked data.
   * [PRODUCTION] Would make a secure API call to the bank/issuer.
   */
  resolveIdentity(
    accountRef: string,
    authorizationProof: string
  ): Promise<{
    maskedName: string;
    maskedAccountId: string;
    institution: string;
    accountHolderConfirmed: boolean;
  }>;
}
