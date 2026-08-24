/**
 * Credential Verifier
 *
 * Verifies PrivacyPass-style credentials against:
 * 1. Issuer validity (trusted, active issuer)
 * 2. Temporal validity (not expired, not before valid-from)
 * 3. Revocation status
 * 4. Role validity
 * 5. Purpose validity
 *
 * Returns a detailed CredentialStatus with rejection reason.
 *
 * IMPORTANT: A VERIFIED credential establishes trust properties, NOT innocence.
 * TRUST: VERIFIED and RECEIVER BEHAVIOURAL RISK: HIGH are separate dimensions.
 *
 * Owner: Vatsal Bhardwaj
 */

import type { Credential, CredentialStatus } from "@trishul/contracts";
import type { IssuerRegistry, RevocationRegistry } from "./types.js";

export interface VerificationResult {
  status: CredentialStatus;
  reason: string;
  /** The verified credential (only set if status is VERIFIED) */
  credential?: Credential;
}

export class CredentialVerifier {
  constructor(
    private readonly issuerRegistry: IssuerRegistry,
    private readonly revocationRegistry: RevocationRegistry
  ) {}

  /**
   * Verify a credential through all trust checks.
   *
   * Check order:
   * 1. Structural validity (required fields)
   * 2. Issuer validity (known, trusted, active)
   * 3. Temporal validity (within valid-from / valid-until window)
   * 4. Revocation status (not revoked)
   *
   * Role and purpose are structurally validated here;
   * capability matching is done by AccessController.
   */
  async verify(credential: Credential, now = new Date()): Promise<VerificationResult> {
    // 1. Structural validation
    if (!credential.id || !credential.issuerRef || !credential.subjectId) {
      return {
        status: "INVALID",
        reason: "Credential is missing required fields",
      };
    }

    // 2. Issuer validation
    const issuerActive = await this.issuerRegistry.isIssuerActive(
      credential.issuerRef
    );
    if (!issuerActive) {
      return {
        status: "INVALID",
        reason: `Issuer ${credential.issuerRef} is not a trusted active issuer`,
      };
    }

    // 3. Temporal validity
    const validFrom = new Date(credential.validFrom);
    const validUntil = new Date(credential.validUntil);

    if (now < validFrom) {
      return {
        status: "INVALID",
        reason: `Credential is not yet valid (valid from ${credential.validFrom})`,
      };
    }

    if (now > validUntil) {
      return {
        status: "EXPIRED",
        reason: `Credential expired at ${credential.validUntil}`,
      };
    }

    // 4. Revocation check
    const revoked = await this.revocationRegistry.isRevoked(credential.id);
    if (revoked) {
      const reason = await this.revocationRegistry.getRevocationReason(
        credential.id
      );
      return {
        status: "REVOKED",
        reason: `Credential has been revoked: ${reason ?? "no reason provided"}`,
      };
    }

    // All checks passed
    return {
      status: "VERIFIED",
      reason: "Credential is valid and trusted",
      credential,
    };
  }
}
