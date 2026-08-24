import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
const caseId = 'case:complaint-anchor-a';
const evidence = {
  kind: 'BANK_STATEMENT_EXCERPT',
  victimAccount: 'acct-private-should-not-be-on-chain',
  transactionReference: 'TX-ANCHOR-1',
  amountMinor: 125_000,
  observedAt: '2026-08-24T13:00:00.000Z',
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createCase(app: ReturnType<typeof buildApp>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': 'create-anchor-case' },
    payload: {
      complaintId: 'complaint-anchor-a',
      originalTransactionRef: 'TX-ANCHOR-1',
      reportedAmount: { amountMinor: 125_000, currency: 'INR' },
      transactionOccurredAt: '2026-08-24T13:00:00.000Z',
      reportedAt: '2026-08-24T13:10:00.000Z',
      category: 'IMPERSONATION',
      source: 'VICTIM',
      evidenceReferences: ['evidence:statement:1'],
    },
  });
}

describe('evidence anchor integrity flow', () => {
  it('anchors a digest without returning raw evidence and detects tampering', async () => {
    const app = buildApp();
    apps.push(app);
    await createCase(app);

    const anchored = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/evidence-anchors`,
      headers: { 'idempotency-key': 'anchor-statement-v1' },
      payload: { evidenceRef: 'evidence:statement:1', evidence },
    });
    const anchoredBody = anchored.json();
    const anchorId = anchoredBody.receipt.anchorId as string;
    const verified = await app.inject({
      method: 'POST',
      url: `/api/v1/evidence-anchors/${anchorId}/verify`,
      payload: { evidence },
    });
    const tampered = await app.inject({
      method: 'POST',
      url: `/api/v1/evidence-anchors/${anchorId}/verify`,
      payload: { evidence: { ...evidence, amountMinor: evidence.amountMinor + 1 } },
    });

    expect(anchored.statusCode).toBe(201);
    expect(anchoredBody).toMatchObject({
      replayed: false,
      receipt: {
        caseId,
        evidenceRef: 'evidence:statement:1',
        provider: 'TRISHUL_DEVELOPMENT_HASHCHAIN',
        network: 'in-memory-development',
      },
    });
    expect(JSON.stringify(anchoredBody)).not.toContain(evidence.victimAccount);
    expect(verified.json()).toMatchObject({
      anchorId,
      payloadHashMatches: true,
      ledgerReceiptValid: true,
      verified: true,
    });
    expect(tampered.json()).toMatchObject({
      anchorId,
      payloadHashMatches: false,
      ledgerReceiptValid: true,
      verified: false,
    });
  });

  it('replays the same request and rejects changed evidence under the same key', async () => {
    const app = buildApp();
    apps.push(app);
    await createCase(app);
    const request = {
      method: 'POST' as const,
      url: `/api/v1/cases/${caseId}/evidence-anchors`,
      headers: { 'idempotency-key': 'anchor-idempotent-v1' },
      payload: { evidenceRef: 'evidence:statement:1', evidence },
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);
    const duplicateSubmission = await app.inject({
      ...request,
      headers: { 'idempotency-key': 'anchor-same-evidence-new-key' },
    });
    const conflict = await app.inject({
      ...request,
      payload: {
        ...request.payload,
        evidence: { ...evidence, amountMinor: evidence.amountMinor + 1 },
      },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      replayed: true,
      receipt: { anchorId: first.json().receipt.anchorId },
    });
    expect(duplicateSubmission.statusCode).toBe(200);
    expect(duplicateSubmission.json()).toMatchObject({
      replayed: true,
      receipt: { anchorId: first.json().receipt.anchorId },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('does not anchor evidence for an unknown case', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:missing/evidence-anchors',
      headers: { 'idempotency-key': 'anchor-missing-case' },
      payload: { evidenceRef: 'evidence:missing', evidence },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('NOT_FOUND');
  });
});
