import { describe, expect, it } from 'vitest';
import { TrustAccessService } from '../src/access-service.js';
import { InMemoryTrustRepository } from '../src/access-service.js';
import type { BlockchainAnchorService, BlockchainAnchorReceipt } from '@trishul/contracts';
import { randomUUID } from 'crypto';

class MockBlockchain implements BlockchainAnchorService {
  anchors: any[] = [];
  async anchor(hash: string, metadata: Record<string, string>): Promise<BlockchainAnchorReceipt> {
    const receipt = { txRef: randomUUID(), anchorTimestamp: new Date().toISOString() };
    this.anchors.push({ hash, metadata, receipt });
    return receipt;
  }
  async verify(): Promise<boolean> {
    return true;
  }
}

describe('Blockchain Integration', () => {
  it('anchors issuer registration and credential revocation', async () => {
    const blockchain = new MockBlockchain();
    const service = new TrustAccessService(new InMemoryTrustRepository(), blockchain);

    const pemKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALgC2/Yf/P4oNnJ8B/O3Kz6zF6bB8zL8zL8zL8zL8zL8=
-----END PUBLIC KEY-----`;
    await service.registerIssuer('bank-c', pemKey);
    expect(blockchain.anchors.length).toBe(1);
    expect(blockchain.anchors[0].metadata.action).toBe('REGISTER_ISSUER');

    await service.revokeCredential('cred-123');
    expect(blockchain.anchors.length).toBe(2);
    expect(blockchain.anchors[1].metadata.action).toBe('REVOKE_CREDENTIAL');
  });
});
