import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const caseId = 'case:complaint-golden-a';
const complaint = {
  complaintId: 'complaint-golden-a',
  originalTransactionRef: 'T1001',
  reportedAmount: { amountMinor: 5_000_000, currency: 'INR' },
  transactionOccurredAt: '2026-08-24T10:00:00.000Z',
  reportedAt: '2026-08-24T10:15:00.000Z',
  payerReference: 'acct-kavya',
  beneficiaryReference: 'vpa-receiver-a',
  category: 'IMPERSONATION',
  source: 'VICTIM',
  evidenceReferences: ['evidence-screen-1'],
};

describe('synthetic presentation profile', () => {
  it('grants no-credential access only to explicitly scoped synthetic cases', async () => {
    const app = buildApp({
      syntheticDemoCaseIds: [caseId],
      corsOrigins: ['https://trishul-demo.example'],
    });
    apps.push(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      headers: { 'idempotency-key': 'demo:complaint:golden-a' },
      payload: complaint,
    });

    const priority = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${encodeURIComponent(caseId)}/priority`,
      headers: {
        'idempotency-key': 'demo:priority:golden-a',
        origin: 'https://trishul-demo.example',
      },
    });
    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/v1/command-center',
      headers: { origin: 'https://trishul-demo.example' },
    });
    const outOfScope = await app.inject({
      method: 'GET',
      url: '/api/v1/cases/case%3Aunrelated/priority/latest',
    });
    const manifest = await app.inject({ method: 'GET', url: '/api/v1/system/manifest' });

    expect(priority.statusCode).toBe(201);
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.headers['access-control-allow-origin']).toBe('https://trishul-demo.example');
    expect(dashboard.json().commandCenter.scopeCaseIds).toEqual([caseId]);
    expect(outOfScope.statusCode).toBe(401);
    expect(manifest.json().demoProfile).toBe('GOLDEN_SYNTHETIC');
  });

  it('keeps command-center access credential-gated when the demo profile is disabled', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/command-center' });
    expect(response.statusCode).toBe(401);
  });
});
