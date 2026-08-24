import { describe, expect, it } from 'vitest';
import { evaluateCredentialPolicy } from '../src/index.js';

describe('evaluateCredentialPolicy', () => {
  it('verifies trust properties without returning a fraud judgment', () => {
    expect(
      evaluateCredentialPolicy({
        issuerTrusted: true,
        signatureValid: true,
        revoked: false,
        nonceFresh: true,
        roleMatches: true,
        purposeAllowed: true,
      }),
    ).toEqual({
      status: 'VERIFIED',
      reasonCodes: ['TRUST_PROPERTIES_VERIFIED'],
      policyVersion: 'credential-policy-v1',
    });
  });

  it('rejects nonce replay', () => {
    const result = evaluateCredentialPolicy({
      issuerTrusted: true,
      signatureValid: true,
      revoked: false,
      nonceFresh: false,
      roleMatches: true,
      purposeAllowed: true,
    });

    expect(result.status).toBe('INVALID');
    expect(result.reasonCodes).toContain('NONCE_REPLAY_OR_EXPIRED');
  });
});
