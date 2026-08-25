import {
  DevelopmentHashchainProvider,
  RemoteEvidenceAnchorProvider,
  type EvidenceAnchorProvider,
} from '@trishul/audit';

export function evidenceAnchorProviderFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): EvidenceAnchorProvider {
  const mode = environment.EVIDENCE_ANCHOR_MODE ?? 'DEVELOPMENT_HASHCHAIN';
  if (mode === 'REMOTE_GATEWAY') {
    const allowInsecureHttp = environment.EVIDENCE_ANCHOR_ALLOW_INSECURE_HTTP === 'true';
    if (environment.NODE_ENV === 'production' && allowInsecureHttp) {
      throw new Error('Production evidence anchoring cannot allow insecure HTTP.');
    }
    return new RemoteEvidenceAnchorProvider({
      gatewayUrl: required(environment, 'EVIDENCE_ANCHOR_GATEWAY_URL'),
      bearerToken: required(environment, 'EVIDENCE_ANCHOR_GATEWAY_TOKEN'),
      timeoutMs: positiveInteger(environment.EVIDENCE_ANCHOR_TIMEOUT_MS, 10_000),
      allowInsecureHttp,
    });
  }
  if (mode !== 'DEVELOPMENT_HASHCHAIN') {
    throw new Error(`Unsupported EVIDENCE_ANCHOR_MODE: ${mode}`);
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('Production requires EVIDENCE_ANCHOR_MODE=REMOTE_GATEWAY.');
  }
  return new DevelopmentHashchainProvider();
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('EVIDENCE_ANCHOR_TIMEOUT_MS must be a positive integer.');
  }
  return value;
}
