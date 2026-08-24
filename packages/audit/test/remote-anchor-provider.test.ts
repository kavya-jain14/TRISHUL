import { describe, expect, it, vi } from 'vitest';
import { hashEvidence, RemoteEvidenceAnchorProvider } from '../src/index.js';

const input = {
  evidenceHash: hashEvidence({ evidence: 'provider-event-a' }),
  submissionHash: hashEvidence({ submission: 'case-a-anchor-a' }),
  anchoredAt: '2026-08-25T00:00:00.000Z',
};
const receipt = {
  provider: 'TRISHUL_CONSORTIUM_GATEWAY',
  network: 'consortium-testnet',
  anchorReference: 'block:1042/tx:7',
  transactionHash: 'a'.repeat(64),
};

describe('RemoteEvidenceAnchorProvider', () => {
  it('submits only hashes and returns a validated transaction receipt', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(receipt), { status: 201 }));
    const provider = new RemoteEvidenceAnchorProvider({
      gatewayUrl: 'https://ledger.example.test/root/',
      bearerToken: 'gateway-secret',
      request,
    });

    await expect(provider.anchor(input)).resolves.toEqual(receipt);
    const [url, options] = request.mock.calls[0]!;
    expect(String(url)).toBe('https://ledger.example.test/root/v1/evidence-anchors');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer gateway-secret',
        'idempotency-key': input.submissionHash,
      },
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      schemaVersion: 'trishul-evidence-anchor-v1',
      evidenceHash: input.evidenceHash,
      submissionHash: input.submissionHash,
      requestedAt: input.anchoredAt,
    });
    expect(String(options?.body)).not.toContain('case-a');
    expect(String(options?.body)).not.toContain('provider-event-a');
  });

  it('verifies the exact remote transaction reference and hash', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          verified: true,
          anchorReference: receipt.anchorReference,
          transactionHash: receipt.transactionHash,
        }),
        { status: 200 },
      ),
    );
    const provider = new RemoteEvidenceAnchorProvider({
      gatewayUrl: 'https://ledger.example.test/',
      bearerToken: 'gateway-secret',
      request,
    });

    await expect(provider.verify({ ...input, ...receipt })).resolves.toBe(true);
    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          verified: true,
          anchorReference: 'block:other/tx:1',
          transactionHash: receipt.transactionHash,
        }),
        { status: 200 },
      ),
    );
    await expect(provider.verify({ ...input, ...receipt })).resolves.toBe(false);
  });

  it('requires secure configuration and never includes gateway bodies in errors', async () => {
    expect(
      () =>
        new RemoteEvidenceAnchorProvider({
          gatewayUrl: 'http://ledger.example.test',
          bearerToken: 'secret',
        }),
    ).toThrow(/HTTPS/);
    expect(
      () =>
        new RemoteEvidenceAnchorProvider({
          gatewayUrl: 'https://ledger.example.test',
          bearerToken: '',
        }),
    ).toThrow(/token/);

    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"private":"must-not-leak"}', { status: 503 }));
    const provider = new RemoteEvidenceAnchorProvider({
      gatewayUrl: 'https://ledger.example.test',
      bearerToken: 'gateway-secret',
      request,
    });
    await expect(provider.anchor(input)).rejects.toThrow('HTTP 503');
    await expect(provider.anchor(input)).rejects.not.toThrow(/must-not-leak|gateway-secret/);
  });

  it('rejects malformed receipts and oversized responses', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...receipt, transactionHash: 'not-a-hash' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response('x'.repeat(70_000), { status: 200 }));
    const provider = new RemoteEvidenceAnchorProvider({
      gatewayUrl: 'https://ledger.example.test',
      bearerToken: 'gateway-secret',
      request,
    });

    await expect(provider.anchor(input)).rejects.toThrow(/transactionHash/);
    await expect(provider.anchor(input)).rejects.toThrow(/size limit/);
  });
});
