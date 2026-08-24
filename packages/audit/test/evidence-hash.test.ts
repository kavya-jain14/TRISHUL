import { describe, expect, it } from 'vitest';
import { hashEvidence, verifyEvidenceHash } from '../src/index.js';

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
