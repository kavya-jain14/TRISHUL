/**
 * Credential Registry Service
 *
 * Manages the blockchain credential registry:
 * - Register credentials (anchor credential hash on-chain)
 * - Check registry status
 * - Revoke credentials (update registry + mark revocation)
 *
 * Uses the BlockchainAnchorService interface.
 * The prototype uses an in-memory simulator (@trishul/audit).
 * Fuzail's production service should implement the same interface.
 *
 * Owner: Vatsal Bhardwaj
 */

import { createHash } from "crypto";
import type { Credential, CredentialRegistryEntry } from "@trishul/contracts";
import type { BlockchainAnchorService, AuditService } from "./types.js";

export class CredentialRegistryService {
  /** In-memory registry for prototype — maps credentialHash → entry */
  private registry = new Map<string, CredentialRegistryEntry>();

  constructor(
    private readonly blockchainAnchor: BlockchainAnchorService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Compute the SHA-256 hash of a credential for on-chain anchoring.
   * Only the hash is stored on-chain, never the raw credential.
   */
  hashCredential(credential: Credential): string {
    const payload = JSON.stringify({
      id: credential.id,
      issuerRef: credential.issuerRef,
      subjectId: credential.subjectId,
      role: credential.role,
      purpose: credential.purpose,
      validFrom: credential.validFrom,
      validUntil: credential.validUntil,
      publicKeyHash: credential.publicKeyHash,
    });
    return createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Register a credential on-chain.
   * Anchors the credential hash and records the transaction reference.
   */
  async register(
    credential: Credential
  ): Promise<CredentialRegistryEntry> {
    const credentialHash = this.hashCredential(credential);

    // Anchor hash on-chain
    const anchorResult = await this.blockchainAnchor.anchor(credentialHash, {
      type: "credential_registration",
      credentialId: credential.id,
      issuerRef: credential.issuerRef,
      role: credential.role,
    });

    const entry: CredentialRegistryEntry = {
      credentialHash,
      issuerRef: credential.issuerRef,
      status: "ACTIVE",
      anchorTimestamp: anchorResult.anchorTimestamp,
      txRef: anchorResult.txRef,
    };

    this.registry.set(credentialHash, entry);

    // Audit
    await this.auditService.record({
      actor: "SYSTEM",
      action: "CREDENTIAL_REGISTERED",
      authorizationResult: "NOT_APPLICABLE",
      credentialRef: credential.id,
      outcome: `Credential registered on-chain with hash ${credentialHash.slice(0, 16)}...`,
      blockchainAnchorRef: anchorResult.txRef,
    });

    return entry;
  }

  /**
   * Check the on-chain status of a credential.
   */
  async checkStatus(
    credentialHash: string
  ): Promise<CredentialRegistryEntry | null> {
    return this.registry.get(credentialHash) ?? null;
  }

  /**
   * Revoke a credential on-chain.
   * Updates the registry status and anchors the revocation.
   */
  async revoke(
    credential: Credential,
    reason: string
  ): Promise<CredentialRegistryEntry> {
    const credentialHash = this.hashCredential(credential);

    // Anchor revocation on-chain
    const anchorResult = await this.blockchainAnchor.anchor(credentialHash, {
      type: "credential_revocation",
      credentialId: credential.id,
      reason,
    });

    const entry: CredentialRegistryEntry = {
      credentialHash,
      issuerRef: credential.issuerRef,
      status: "REVOKED",
      anchorTimestamp: anchorResult.anchorTimestamp,
      txRef: anchorResult.txRef,
    };

    this.registry.set(credentialHash, entry);

    // Audit
    await this.auditService.record({
      actor: "SYSTEM",
      action: "CREDENTIAL_REVOKED",
      authorizationResult: "NOT_APPLICABLE",
      credentialRef: credential.id,
      outcome: `Credential revoked on-chain: ${reason}`,
      blockchainAnchorRef: anchorResult.txRef,
    });

    return entry;
  }

  /**
   * Verify that a credential's on-chain record matches the expected hash.
   */
  async verifyIntegrity(
    credential: Credential
  ): Promise<{ verified: boolean; txRef?: string }> {
    const credentialHash = this.hashCredential(credential);
    const entry = this.registry.get(credentialHash);

    if (!entry) {
      return { verified: false };
    }

    const onChainVerified = await this.blockchainAnchor.verify(
      entry.txRef,
      credentialHash
    );

    return { verified: onChainVerified, txRef: entry.txRef };
  }
}
