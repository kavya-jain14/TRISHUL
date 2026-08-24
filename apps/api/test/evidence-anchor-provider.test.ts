import { DevelopmentHashchainProvider, RemoteEvidenceAnchorProvider } from '@trishul/audit';
import { describe, expect, it } from 'vitest';
import { evidenceAnchorProviderFromEnvironment } from '../src/modules/evidence-anchors/provider.js';

describe('evidence anchor provider configuration', () => {
  it('uses the explicitly labelled hashchain only outside production', () => {
    expect(
      evidenceAnchorProviderFromEnvironment({
        NODE_ENV: 'development',
        EVIDENCE_ANCHOR_MODE: 'DEVELOPMENT_HASHCHAIN',
      }),
    ).toBeInstanceOf(DevelopmentHashchainProvider);
    expect(() =>
      evidenceAnchorProviderFromEnvironment({
        NODE_ENV: 'production',
        EVIDENCE_ANCHOR_MODE: 'DEVELOPMENT_HASHCHAIN',
      }),
    ).toThrow(/Production requires/);
  });

  it('builds the remote provider only with complete secure configuration', () => {
    expect(
      evidenceAnchorProviderFromEnvironment({
        NODE_ENV: 'production',
        EVIDENCE_ANCHOR_MODE: 'REMOTE_GATEWAY',
        EVIDENCE_ANCHOR_GATEWAY_URL: 'https://ledger.example.test/',
        EVIDENCE_ANCHOR_GATEWAY_TOKEN: 'service-token',
        EVIDENCE_ANCHOR_TIMEOUT_MS: '5000',
      }),
    ).toBeInstanceOf(RemoteEvidenceAnchorProvider);
    expect(() =>
      evidenceAnchorProviderFromEnvironment({
        NODE_ENV: 'production',
        EVIDENCE_ANCHOR_MODE: 'REMOTE_GATEWAY',
        EVIDENCE_ANCHOR_GATEWAY_URL: 'https://ledger.example.test/',
      }),
    ).toThrow(/TOKEN/);
    expect(() =>
      evidenceAnchorProviderFromEnvironment({
        NODE_ENV: 'production',
        EVIDENCE_ANCHOR_MODE: 'REMOTE_GATEWAY',
        EVIDENCE_ANCHOR_GATEWAY_URL: 'http://ledger.example.test/',
        EVIDENCE_ANCHOR_GATEWAY_TOKEN: 'service-token',
        EVIDENCE_ANCHOR_ALLOW_INSECURE_HTTP: 'true',
      }),
    ).toThrow(/cannot allow insecure HTTP/);
  });
});
