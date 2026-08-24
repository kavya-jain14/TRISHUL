import type { EvidenceAnchorProvider } from './evidence-hash.js';

const DIGEST = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface RemoteEvidenceAnchorProviderConfig {
  gatewayUrl: string;
  bearerToken: string;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  request?: typeof fetch;
}

interface RemoteReceipt {
  provider: string;
  network: string;
  anchorReference: string;
  transactionHash: string;
}

/**
 * Production adapter for an authorised blockchain/consortium-ledger gateway.
 * Only hashes and receipt identifiers cross this boundary; evidence and case data never do.
 */
export class RemoteEvidenceAnchorProvider implements EvidenceAnchorProvider {
  private readonly gatewayUrl: URL;
  private readonly timeoutMs: number;
  private readonly request: typeof fetch;

  constructor(private readonly config: RemoteEvidenceAnchorProviderConfig) {
    this.gatewayUrl = normaliseGatewayUrl(config.gatewayUrl, config.allowInsecureHttp ?? false);
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 10_000, 'timeoutMs');
    this.request = config.request ?? fetch;
    if (!config.bearerToken.trim() || /[\r\n]/.test(config.bearerToken)) {
      throw new Error('The evidence-anchor gateway token is invalid.');
    }
  }

  async anchor(input: {
    evidenceHash: string;
    submissionHash: string;
    anchoredAt: string;
  }): Promise<RemoteReceipt> {
    validateDigest(input.evidenceHash, 'evidenceHash');
    validateDigest(input.submissionHash, 'submissionHash');
    validateTimestamp(input.anchoredAt, 'anchoredAt');
    const payload = {
      schemaVersion: 'trishul-evidence-anchor-v1',
      evidenceHash: input.evidenceHash,
      submissionHash: input.submissionHash,
      requestedAt: input.anchoredAt,
    };
    const response = await this.call('v1/evidence-anchors', payload, input.submissionHash);
    return parseReceipt(response);
  }

  async verify(input: {
    evidenceHash: string;
    submissionHash: string;
    anchorReference: string;
    transactionHash: string;
  }): Promise<boolean> {
    validateDigest(input.evidenceHash, 'evidenceHash');
    validateDigest(input.submissionHash, 'submissionHash');
    validateIdentifier(input.anchorReference, 'anchorReference');
    validateDigest(input.transactionHash, 'transactionHash');
    const response = await this.call('v1/evidence-anchors/verify', {
      schemaVersion: 'trishul-evidence-anchor-v1',
      ...input,
    });
    if (!isRecord(response) || typeof response.verified !== 'boolean') {
      throw new Error('Evidence-anchor gateway returned an invalid verification response.');
    }
    if (response.verified !== true) return false;
    return (
      response.anchorReference === input.anchorReference &&
      response.transactionHash === input.transactionHash
    );
  }

  private async call(path: string, payload: object, idempotencyKey?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();
    try {
      const response = await this.request(new URL(path, this.gatewayUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.config.bearerToken}`,
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Evidence-anchor gateway request failed with HTTP ${response.status}.`);
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('Evidence-anchor gateway response exceeded the size limit.');
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error('Evidence-anchor gateway returned invalid JSON.');
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Evidence-anchor gateway timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseReceipt(value: unknown): RemoteReceipt {
  if (!isRecord(value)) throw new Error('Evidence-anchor gateway returned an invalid receipt.');
  const receipt = {
    provider: boundedText(value.provider, 'provider'),
    network: boundedText(value.network, 'network'),
    anchorReference: identifier(value.anchorReference, 'anchorReference'),
    transactionHash: digest(value.transactionHash, 'transactionHash'),
  };
  return receipt;
}

function normaliseGatewayUrl(raw: string, allowInsecureHttp: boolean): URL {
  const url = new URL(raw.endsWith('/') ? raw : `${raw}/`);
  if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) {
    throw new Error('The evidence-anchor gateway must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'The evidence-anchor gateway URL must not contain credentials, query, or hash.',
    );
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new Error(`Evidence-anchor gateway returned an invalid ${name}.`);
  }
  return value;
}

function identifier(value: unknown, name: string): string {
  validateIdentifier(value, name);
  return value;
}

function digest(value: unknown, name: string): string {
  validateDigest(value, name);
  return value;
}

function validateIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${name}.`);
  }
}

function validateDigest(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`Invalid ${name}.`);
}

function validateTimestamp(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${name}.`);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}
