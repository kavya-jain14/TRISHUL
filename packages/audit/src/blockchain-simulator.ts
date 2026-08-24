/**
 * Blockchain Simulator
 *
 * [SIMULATOR] In-memory blockchain anchor service for the prototype.
 * Clearly labeled as a simulator — NOT a production blockchain.
 *
 * Implements the BlockchainAnchorService interface defined in @trishul/trust.
 * Fuzail's production anchor service should implement the same interface
 * to replace this simulator with a real blockchain backend.
 *
 * Owner: Vatsal Bhardwaj
 * Integration: Fuzail (replace with real blockchain service)
 */

import { createHash, randomBytes } from "crypto";

interface SimulatedBlock {
  txRef: string;
  hash: string;
  metadata: Record<string, string>;
  anchorTimestamp: string;
  blockNumber: number;
}

export class BlockchainSimulator {
  private blocks = new Map<string, SimulatedBlock>();
  private blockCounter = 0;

  /**
   * [SIMULATOR] Anchor a hash on the simulated blockchain.
   *
   * In production, this would submit a transaction to a real blockchain.
   * The simulator generates a deterministic tx reference and stores the anchor.
   */
  async anchor(
    hash: string,
    metadata: Record<string, string>
  ): Promise<{ txRef: string; anchorTimestamp: string }> {
    this.blockCounter++;
    const txRef = `sim_tx_${randomBytes(16).toString("hex")}`;
    const anchorTimestamp = new Date().toISOString();

    const block: SimulatedBlock = {
      txRef,
      hash,
      metadata,
      anchorTimestamp,
      blockNumber: this.blockCounter,
    };

    this.blocks.set(txRef, block);

    console.log(
      `[SIMULATOR] Blockchain anchor created: block #${this.blockCounter}, tx=${txRef.slice(0, 20)}..., hash=${hash.slice(0, 16)}...`
    );

    return { txRef, anchorTimestamp };
  }

  /**
   * [SIMULATOR] Verify that a hash was previously anchored.
   *
   * In production, this would query the blockchain to verify the anchor.
   */
  async verify(txRef: string, expectedHash: string): Promise<boolean> {
    const block = this.blocks.get(txRef);
    if (!block) {
      console.log(
        `[SIMULATOR] Verification failed: tx=${txRef} not found`
      );
      return false;
    }

    const verified = block.hash === expectedHash;
    console.log(
      `[SIMULATOR] Verification ${verified ? "passed" : "failed"}: tx=${txRef.slice(0, 20)}...`
    );
    return verified;
  }

  /**
   * [SIMULATOR] Get the total number of simulated blocks.
   */
  get blockCount(): number {
    return this.blockCounter;
  }

  /**
   * [SIMULATOR] Get a simulated block by tx reference.
   */
  getBlock(txRef: string): SimulatedBlock | undefined {
    return this.blocks.get(txRef);
  }

  /**
   * [SIMULATOR] Reset the simulator (for testing).
   */
  reset(): void {
    this.blocks.clear();
    this.blockCounter = 0;
  }
}
