/**
 * Identity Resolution Service
 *
 * Implements the lawful identity-resolution workflow:
 *
 * 1. An active reported case exists
 * 2. An investigator proves a valid role/purpose credential
 * 3. TRISHUL references the traced account and relevant bank/issuer
 * 4. The regulated institution performs the secure off-chain account ↔ KYC lookup
 * 5. Only permitted identity information is returned
 * 6. The request, authorization proof, resolution and access are audited
 *
 * ARCHITECTURAL BOUNDARY:
 * Blockchain does NOT reveal KYC identity.
 * The regulated bank/issuer owns the authoritative account-to-KYC mapping.
 * TRISHUL only coordinates the authorized request and records the audit trail.
 *
 * Owner: Vatsal Bhardwaj
 * Integration: Sandhya (case service), Fuzail (account references)
 */

import type {
  Credential,
  IdentityResolutionResult,
} from "@trishul/contracts";
import { CredentialVerifier } from "./credential-verifier.js";
import { NonceStore } from "./nonce-store.js";
import { AccessController } from "./access-control.js";
import type {
  CaseService,
  AuditService,
  BankKycLookupService,
  IdentityResolutionContext,
} from "./types.js";
import { randomUUID } from "crypto";

export class IdentityResolutionService {
  constructor(
    private readonly credentialVerifier: CredentialVerifier,
    private readonly nonceStore: NonceStore,
    private readonly accessController: AccessController,
    private readonly caseService: CaseService,
    private readonly auditService: AuditService,
    private readonly bankKycLookup: BankKycLookupService
  ) {}

  /**
   * Process an identity resolution request.
   *
   * This is the most sensitive operation in the trust module.
   * Every step is validated and audited.
   */
  async resolve(
    context: IdentityResolutionContext
  ): Promise<IdentityResolutionResult> {
    const { caseId, accountRef, investigatorCredential, challengeNonce } =
      context;
    const requestId = randomUUID();
    const now = new Date();

    // ── Step 1: Verify active case exists ──────────────────────────────────

    const caseContext = await this.caseService.getCaseContext(caseId);
    if (!caseContext) {
      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_DENIED",
        caseId,
        authorizationResult: "DENIED",
        credentialRef: investigatorCredential.id,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution denied: case ${caseId} does not exist`,
      });

      return {
        requestId,
        status: "DENIED",
        reason: "No active case found for the specified case ID",
        auditRef,
        processedAt: now.toISOString(),
      };
    }

    if (!caseContext.isActive) {
      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_DENIED",
        caseId,
        authorizationResult: "DENIED",
        credentialRef: investigatorCredential.id,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution denied: case ${caseId} is not active`,
      });

      return {
        requestId,
        status: "DENIED",
        reason: "Case is not currently active",
        auditRef,
        processedAt: now.toISOString(),
      };
    }

    // ── Step 2: Validate nonce freshness ────────────────────────────────────

    const nonceResult = this.nonceStore.consume(challengeNonce);
    if (!nonceResult.valid) {
      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_DENIED",
        caseId,
        authorizationResult: "DENIED",
        credentialRef: investigatorCredential.id,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution denied: ${nonceResult.reason}`,
      });

      return {
        requestId,
        status: "DENIED",
        reason: `Challenge validation failed: ${nonceResult.reason}`,
        auditRef,
        processedAt: now.toISOString(),
      };
    }

    // ── Step 3: Verify investigator credential ──────────────────────────────

    const verificationResult = await this.credentialVerifier.verify(
      investigatorCredential,
      now
    );

    if (verificationResult.status !== "VERIFIED") {
      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_DENIED",
        caseId,
        authorizationResult: "DENIED",
        credentialRef: investigatorCredential.id,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution denied: credential ${verificationResult.status} — ${verificationResult.reason}`,
      });

      return {
        requestId,
        status: "DENIED",
        reason: `Credential verification failed: ${verificationResult.reason}`,
        auditRef,
        processedAt: now.toISOString(),
      };
    }

    // ── Step 4: Check purpose match ─────────────────────────────────────────

    if (investigatorCredential.purpose !== "IDENTITY_RESOLUTION") {
      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_DENIED",
        caseId,
        authorizationResult: "DENIED",
        credentialRef: investigatorCredential.id,
        purpose: investigatorCredential.purpose,
        outcome: `Identity resolution denied: credential purpose is ${investigatorCredential.purpose}, not IDENTITY_RESOLUTION`,
      });

      return {
        requestId,
        status: "DENIED",
        reason: `Purpose mismatch: credential purpose is ${investigatorCredential.purpose}, required IDENTITY_RESOLUTION`,
        auditRef,
        processedAt: now.toISOString(),
      };
    }

    // ── Step 5: Evaluate access (role + purpose → capability) ───────────────

    const accessResult = this.accessController.evaluate({
      credential: investigatorCredential,
      requestedCapability: "IDENTITY_RESOLUTION",
      caseContext,
    });

    if (accessResult.verdict !== "AUTHORIZED") {
      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_DENIED",
        caseId,
        authorizationResult: "DENIED",
        credentialRef: investigatorCredential.id,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution denied: ${accessResult.verdict} — ${accessResult.reason}`,
      });

      return {
        requestId,
        status: "DENIED",
        reason: `Access denied: ${accessResult.reason}`,
        auditRef,
        processedAt: now.toISOString(),
      };
    }

    // ── Step 6: Validate account/case relationship ──────────────────────────

    if (!caseContext.accountRefs.includes(accountRef)) {
      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_DENIED",
        caseId,
        authorizationResult: "DENIED",
        credentialRef: investigatorCredential.id,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution denied: account ${accountRef} is not associated with case ${caseId}`,
      });

      return {
        requestId,
        status: "DENIED",
        reason: "Account reference is not associated with the specified case",
        auditRef,
        processedAt: now.toISOString(),
      };
    }

    // ── Step 7: Record authorization and proceed with resolution ────────────

    await this.auditService.record({
      actor: investigatorCredential.subjectId,
      action: "IDENTITY_RESOLUTION_AUTHORIZED",
      caseId,
      authorizationResult: "GRANTED",
      credentialRef: investigatorCredential.id,
      sessionRef: accessResult.sessionId,
      purpose: "IDENTITY_RESOLUTION",
      outcome: `Identity resolution authorized for account ${accountRef} in case ${caseId}`,
    });

    // ── Step 8: Coordinate off-chain KYC lookup via regulated institution ───

    try {
      const kycResult = await this.bankKycLookup.resolveIdentity(
        accountRef,
        accessResult.sessionId ?? requestId
      );

      // ── Step 9: Record successful resolution ───────────────────────────────

      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_COMPLETED",
        caseId,
        authorizationResult: "GRANTED",
        credentialRef: investigatorCredential.id,
        sessionRef: accessResult.sessionId,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution completed for account ${accountRef} via ${kycResult.institution}`,
      });

      return {
        requestId,
        status: "RESOLVED",
        redactedInfo: {
          maskedName: kycResult.maskedName,
          maskedAccountId: kycResult.maskedAccountId,
          resolvingInstitution: kycResult.institution,
          resolvedAt: new Date().toISOString(),
          accountHolderConfirmed: kycResult.accountHolderConfirmed,
        },
        auditRef,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      // ── Resolution failed at the institution level ──────────────────────

      const auditRef = await this.auditService.record({
        actor: investigatorCredential.subjectId,
        action: "IDENTITY_RESOLUTION_FAILED",
        caseId,
        authorizationResult: "GRANTED",
        credentialRef: investigatorCredential.id,
        sessionRef: accessResult.sessionId,
        purpose: "IDENTITY_RESOLUTION",
        outcome: `Identity resolution failed for account ${accountRef}: ${error instanceof Error ? error.message : "Unknown error"}`,
      });

      return {
        requestId,
        status: "FAILED",
        reason: "Identity resolution failed at the resolving institution",
        auditRef,
        processedAt: new Date().toISOString(),
      };
    }
  }
}
