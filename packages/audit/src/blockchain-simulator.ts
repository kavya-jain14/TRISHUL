import { createHash, randomUUID } from 'crypto';
import type { BlockchainAnchorService, BlockchainAnchorReceipt } from '@trishul/contracts';

interface SimulatedBlock {
  txRef: string;
  hash: string;
  metadata: Record<string, string>;
  anchorTimestamp: string;
  blockNumber: number;
}

export class BlockchainSimulator implements BlockchainAnchorService {
  private blocks: Map<string, SimulatedBlock> = new Map();
  private blockCounter: number = 0;

  async anchor(hash: string, metadata: Record<string, string>): Promise<BlockchainAnchorReceipt> {
    const txRef = `tx-${randomUUID()}`;
    const anchorTimestamp = new Date().toISOString();
    this.blockCounter++;
    
    // In a real blockchain, the block hash is based on the previous block.
    // For this simulator, we just store the payload.
    const block: SimulatedBlock = {
      txRef,
      hash,
      metadata,
      anchorTimestamp,
      blockNumber: this.blockCounter,
    };
    
    this.blocks.set(txRef, block);
    
    return {
      txRef,
      anchorTimestamp,
    };
  }

  async verify(txRef: string, expectedHash: string): Promise<boolean> {
    const block = this.blocks.get(txRef);
    if (!block) return false;
    return block.hash === expectedHash;
  }

  get blockCount(): number {
    return this.blockCounter;
  }

  getBlock(txRef: string): SimulatedBlock | undefined {
    return this.blocks.get(txRef);
  }

  reset(): void {
    this.blocks.clear();
    this.blockCounter = 0;
  }
}
