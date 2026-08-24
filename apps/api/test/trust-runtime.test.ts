import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { trustAccessRuntimeFromEnvironment } from '../src/modules/trust/runtime.js';

function issuer(active = true) {
  const pair = generateKeyPairSync('ed25519');
  return {
    issuerId: 'issuer:runtime-bank',
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    active,
  };
}

describe('Trust/Access runtime configuration', () => {
  it('keeps the deterministic demo optional outside production', () => {
    const runtime = trustAccessRuntimeFromEnvironment({ NODE_ENV: 'development' });

    expect(runtime.mode).toBe('DEVELOPMENT_OPTIONAL');
    expect(runtime.enforceTrustAccess).toBe(false);
    expect(runtime.activeIssuerCount).toBe(0);
  });

  it('fails closed when production enforcement or active issuers are missing', () => {
    expect(() => trustAccessRuntimeFromEnvironment({ NODE_ENV: 'production' })).toThrow(
      /requires TRISHUL_TRUST_ACCESS_MODE=ENFORCED/,
    );
    expect(() =>
      trustAccessRuntimeFromEnvironment({
        NODE_ENV: 'production',
        TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
        TRISHUL_TRUSTED_ISSUERS_JSON: '[]',
      }),
    ).toThrow(/at least one active trusted issuer/);
    expect(() =>
      trustAccessRuntimeFromEnvironment({
        NODE_ENV: 'production',
        TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
        TRISHUL_TRUSTED_ISSUERS_JSON: JSON.stringify([issuer(false)]),
      }),
    ).toThrow(/at least one active trusted issuer/);
  });

  it('loads validated issuer and revocation bootstrap state for enforced mode', () => {
    const runtime = trustAccessRuntimeFromEnvironment({
      NODE_ENV: 'production',
      TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
      TRISHUL_TRUSTED_ISSUERS_JSON: JSON.stringify([issuer()]),
      TRISHUL_REVOKED_CREDENTIAL_IDS_JSON: JSON.stringify([
        'credential:revoked-a',
        'credential:revoked-a',
      ]),
    });

    expect(runtime.enforceTrustAccess).toBe(true);
    expect(runtime.activeIssuerCount).toBe(1);
    expect(runtime.revokedCredentialCount).toBe(1);
  });

  it('rejects malformed bootstrap data without echoing it', () => {
    const secretLikeInvalidValue = 'do-not-echo-this';
    expect(() =>
      trustAccessRuntimeFromEnvironment({
        NODE_ENV: 'production',
        TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
        TRISHUL_TRUSTED_ISSUERS_JSON: secretLikeInvalidValue,
      }),
    ).toThrow('TRISHUL_TRUSTED_ISSUERS_JSON must contain valid JSON.');
    try {
      trustAccessRuntimeFromEnvironment({
        NODE_ENV: 'production',
        TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
        TRISHUL_TRUSTED_ISSUERS_JSON: secretLikeInvalidValue,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretLikeInvalidValue);
    }
  });
});
