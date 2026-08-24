import { createHash, timingSafeEqual } from 'node:crypto';

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalise(nested)]),
    );
  }

  return value;
}

export function hashEvidence(value: unknown): string {
  const canonicalJson = JSON.stringify(canonicalise(value));
  return createHash('sha256').update(canonicalJson).digest('hex');
}

export function verifyEvidenceHash(value: unknown, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;

  const actual = Buffer.from(hashEvidence(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return timingSafeEqual(actual, expected);
}

export interface EvidenceAnchorProvider {
  anchor(input: {
    evidenceId: string;
    evidenceHash: string;
    anchoredAt: string;
  }): Promise<{ anchorReference: string }>;

  verify(input: { evidenceHash: string; anchorReference: string }): Promise<boolean>;
}
