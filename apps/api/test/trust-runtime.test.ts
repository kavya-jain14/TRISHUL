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
  it('keeps the deterministic demo optional outside production', async () => {
    const runtime = await trustAccessRuntimeFromEnvironment({ NODE_ENV: 'development' });

    expect(runtime.mode).toBe('DEVELOPMENT_OPTIONAL');
    expect(runtime.enforceTrustAccess).toBe(false);
    expect(runtime.activeIssuerCount).toBe(0);
  });

  it('fails closed when production enforcement, persistence, or active issuers are missing', async () => {
    await expect(trustAccessRuntimeFromEnvironment({ NODE_ENV: 'production' })).rejects.toThrow(
      /requires TRISHUL_TRUST_ACCESS_MODE=ENFORCED/,
    );
    await expect(
      trustAccessRuntimeFromEnvironment({
        NODE_ENV: 'production',
        TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
        TRISHUL_TRUSTED_ISSUERS_JSON: '[]',
      }),
    ).rejects.toThrow(/durable PostgreSQL persistence/);
    await expect(
      trustAccessRuntimeFromEnvironment(
        {
          NODE_ENV: 'production',
          TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
          TRISHUL_TRUSTED_ISSUERS_JSON: JSON.stringify([issuer(false)]),
        },
        { durablePersistence: true },
      ),
    ).rejects.toThrow(/at least one active trusted issuer/);
  });

  it('loads validated issuer and revocation bootstrap state for enforced mode', async () => {
    const runtime = await trustAccessRuntimeFromEnvironment(
      {
        NODE_ENV: 'production',
        TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
        TRISHUL_TRUSTED_ISSUERS_JSON: JSON.stringify([issuer()]),
        TRISHUL_REVOKED_CREDENTIAL_IDS_JSON: JSON.stringify([
          'credential:revoked-a',
          'credential:revoked-a',
        ]),
      },
      { durablePersistence: true },
    );

    expect(runtime.enforceTrustAccess).toBe(true);
    expect(runtime.activeIssuerCount).toBe(1);
    expect(runtime.bootstrapRevokedCredentialCount).toBe(1);
  });

  it('rejects malformed bootstrap data without echoing it', async () => {
    const secretLikeInvalidValue = 'do-not-echo-this';
    await expect(
      trustAccessRuntimeFromEnvironment(
        {
          NODE_ENV: 'production',
          TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
          TRISHUL_TRUSTED_ISSUERS_JSON: secretLikeInvalidValue,
        },
        { durablePersistence: true },
      ),
    ).rejects.toThrow('TRISHUL_TRUSTED_ISSUERS_JSON must contain valid JSON.');
    try {
      await trustAccessRuntimeFromEnvironment(
        {
          NODE_ENV: 'production',
          TRISHUL_TRUST_ACCESS_MODE: 'ENFORCED',
          TRISHUL_TRUSTED_ISSUERS_JSON: secretLikeInvalidValue,
        },
        { durablePersistence: true },
      );
    } catch (error) {
      expect(String(error)).not.toContain(secretLikeInvalidValue);
    }
  });
});
