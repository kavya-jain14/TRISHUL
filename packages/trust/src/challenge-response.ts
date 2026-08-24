/**
 * Challenge-Response Service
 *
 * Implements the secure investigator access flow:
 *
 * 1. Investigator requests restricted case access
 * 2. Server issues a fresh nonce/challenge
 * 3. Investigator presents role/purpose credential proof
 * 4. Server verifies: issuer, validity, revocation, role, purpose, nonce freshness
 * 5. Server grants only the permitted capabilities
 * 6. Success and failure are written to audit trail
 *
 * Owner: Vatsal Bhardwaj
 */

import type { Credential, AccessResult, ChallengeResponse } from "@trishul/contracts";
import { NonceStore } from "./nonce-store.js";
import { CredentialVerifier } from "./credential-verifier.js";
import { AccessController } from "./access-control.js";
import type { AuditService, CaseContext } from "./types.js";

export class ChallengeResponseService {
  constructor(
    private readonly nonceStore: NonceStore,
    private readonly credentialVerifier: CredentialVerifier,
    private readonly accessController: AccessController,
    private readonly auditService: AuditService
  ) {}

  /**
   * Issue a fresh challenge for an investigator.
   * The challenge includes a nonce that must be returned in the proof.
   */
  issueChallenge(investigatorId: string): ChallengeResponse {
    const { nonce, challengeId, issuedAt, expiresAt } =
      this.nonceStore.issue(investigatorId);

    return {
      challengeId,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verify an investigator's challenge-response proof.
   *
   * This is the core authentication+authorization flow:
   * 1. Validate nonce freshness (replay protection)
   * 2. Verify credential (issuer, validity, revocation)
   * 3. Evaluate access (role, purpose, capability scoping)
   * 4. Record audit event
   */
  async verifyProof(
    nonce: string,
    credential: Credential,
    requestedCapability: string,
    caseContext?: CaseContext
  ): Promise<AccessResult> {
    const now = new Date();

    // 1. Nonce validation — replay protection
    const nonceResult = this.nonceStore.consume(nonce);
    if (!nonceResult.valid) {
      const verdict =
        nonceResult.reason === "NONCE_REPLAY_DETECTED"
          ? "REPLAY_DETECTED"
          : "NONCE_INVALID";

      await this.auditService.record({
        actor: credential.subjectId,
        action:
          verdict === "REPLAY_DETECTED"
            ? "NONCE_REPLAY_DETECTED"
            : "ACCESS_DENIED",
        caseId: caseContext?.caseId,
        authorizationResult: "DENIED",
        credentialRef: credential.id,
        purpose: credential.purpose,
        outcome: `Access denied: ${nonceResult.reason}`,
      });

      return {
        verdict,
        reason: nonceResult.reason,
        grantedCapabilities: [],
        evaluatedAt: now.toISOString(),
      };
    }

    // 2. Credential verification
    const verificationResult =
      await this.credentialVerifier.verify(credential, now);

    if (verificationResult.status !== "VERIFIED") {
      await this.auditService.record({
        actor: credential.subjectId,
        action: "CREDENTIAL_REJECTED",
        caseId: caseContext?.caseId,
        authorizationResult: "DENIED",
        credentialRef: credential.id,
        purpose: credential.purpose,
        outcome: `Credential rejected: ${verificationResult.reason}`,
      });

      return {
        verdict: "DENIED",
        reason: verificationResult.reason,
        grantedCapabilities: [],
        evaluatedAt: now.toISOString(),
      };
    }

    // 3. Access evaluation — capability scoping
    const accessResult = this.accessController.evaluate({
      credential,
      requestedCapability: requestedCapability as any,
      caseContext,
    });

    // 4. Audit trail
    await this.auditService.record({
      actor: credential.subjectId,
      action:
        accessResult.verdict === "AUTHORIZED"
          ? "ACCESS_GRANTED"
          : "ACCESS_DENIED",
      caseId: caseContext?.caseId,
      authorizationResult:
        accessResult.verdict === "AUTHORIZED" ? "GRANTED" : "DENIED",
      credentialRef: credential.id,
      sessionRef: accessResult.sessionId,
      purpose: credential.purpose,
      outcome: `${accessResult.verdict}: ${accessResult.reason}`,
    });

    return accessResult;
  }
}
