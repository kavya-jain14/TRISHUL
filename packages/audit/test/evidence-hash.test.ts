import { describe, expect, it } from 'vitest';
import { DevelopmentHashchainProvider, hashEvidence, verifyEvidenceHash } from '../src/index.js';

describe('evidence hashing', () => {
  it('is stable across object key order', () => {
    expect(hashEvidence({ b: 2, a: 1 })).toBe(hashEvidence({ a: 1, b: 2 }));
  });

  it('detects evidence mutation', () => {
    const evidence = { eventId: 'evt-1', amountMinor: 5_000_000 };
    const hash = hashEvidence(evidence);

    expect(verifyEvidenceHash(evidence, hash)).toBe(true);
    expect(verifyEvidenceHash({ ...evidence, amountMinor: 5_000_001 }, hash)).toBe(false);
  });
});

describe('development hashchain provider', () => {
  it('anchors only digests and verifies the linked receipt', async () => {
    const provider = new DevelopmentHashchainProvider();
    const input = {
      evidenceHash: hashEvidence({ privateAccount: 'acct-secret', amountMinor: 5_000_000 }),
      submissionHash: hashEvidence({ submission: 'anchor-request-1' }),
      anchoredAt: '2026-08-24T14:00:00.000Z',
    };

    const receipt = await provider.anchor(input);

    expect(JSON.stringify(receipt)).not.toContain('acct-secret');
    await expect(provider.verify({ ...input, ...receipt })).resolves.toBe(true);
    await expect(
      provider.verify({ ...input, ...receipt, evidenceHash: hashEvidence({ tampered: true }) }),
    ).resolves.toBe(false);
  });

  it('returns the same receipt for the same submission hash', async () => {
    const provider = new DevelopmentHashchainProvider();
    const input = {
      evidenceHash: hashEvidence({ evidence: 'same' }),
      submissionHash: hashEvidence({ submission: 'same' }),
      anchoredAt: '2026-08-24T14:00:00.000Z',
    };

    await expect(provider.anchor(input)).resolves.toEqual(await provider.anchor(input));
  });
});
