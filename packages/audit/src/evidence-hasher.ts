/**
 * Evidence Hasher
 *
 * Computes SHA-256 hashes of evidence data and anchors them on-chain.
 * Used to prove that off-chain evidence has not been mutated after anchoring.
 *
 * Owner: Vatsal Bhardwaj
 * Integration: Sandhya (evidence data), Fuzail (blockchain anchoring)
 */

import { createHash } from "crypto";
import type { BlockchainSimulator } from "./blockchain-simulator.js";

export class EvidenceHasher {
  constructor(private readonly blockchainAnchor: BlockchainSimulator) {}

  /**
   * Compute SHA-256 hash of evidence data.
   * @param data - Evidence data (string, Buffer, or serializable object)
   */
  hash(data: string | Buffer | object): string {
    const payload =
      typeof data === "string"
        ? data
        : Buffer.isBuffer(data)
          ? data.toString("utf-8")
          : JSON.stringify(data);

    return createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Compute hash and anchor it on-chain.
   * @param data - Evidence data to hash
   * @param caseId - Associated case ID
   * @returns The evidence hash and blockchain transaction reference
   */
  async hashAndAnchor(
    data: string | Buffer | object,
    caseId: string
  ): Promise<{ evidenceHash: string; txRef: string; anchorTimestamp: string }> {
    const evidenceHash = this.hash(data);

    const anchorResult = await this.blockchainAnchor.anchor(evidenceHash, {
      type: "evidence_anchor",
      caseId,
    });

    return {
      evidenceHash,
      txRef: anchorResult.txRef,
      anchorTimestamp: anchorResult.anchorTimestamp,
    };
  }

  /**
   * Verify that evidence data has not been mutated since anchoring.
   * @param data - Current evidence data
   * @param storedHash - Previously computed hash
   * @returns Whether the data matches the stored hash
   */
  verifyIntegrity(data: string | Buffer | object, storedHash: string): boolean {
    const currentHash = this.hash(data);
    return currentHash === storedHash;
  }

  /**
   * Verify evidence integrity against the on-chain anchor.
   * @param data - Current evidence data
   * @param txRef - Blockchain transaction reference from anchoring
   * @returns Whether the data matches the on-chain record
   */
  async verifyOnChain(
    data: string | Buffer | object,
    txRef: string
  ): Promise<boolean> {
    const currentHash = this.hash(data);
    return this.blockchainAnchor.verify(txRef, currentHash);
  }
}
