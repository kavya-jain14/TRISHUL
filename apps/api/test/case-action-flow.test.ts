import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const complaint = {
  complaintId: 'complaint-action-a',
  originalTransactionRef: 'RRN-ACTION-1',
  reportedAmount: { amountMinor: 125_000, currency: 'INR' },
  transactionOccurredAt: '2026-08-24T09:00:00.000Z',
  reportedAt: '2026-08-24T09:05:00.000Z',
  category: 'IMPERSONATION',
  source: 'BANK',
  evidenceReferences: ['evidence-action-a'],
};

const action = {
  actionId: 'action-bank-a',
  action: 'ALERT_BANK',
  actorRef: 'analyst-fuzail',
  purpose: 'Fraud response coordination',
  rationale: 'Authorised trace evidence requires provider review.',
  sourceUrls: ['https://example.test/evidence/action-a'],
  occurredAt: '2026-08-24T09:10:00.000Z',
};

describe('case action persistence API', () => {
  it('records, replays, and lists an immutable case action', async () => {
    const app = buildApp();
    apps.push(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      headers: { 'idempotency-key': 'create-action-case' },
      payload: complaint,
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: { 'idempotency-key': 'record-action-a' },
      payload: action,
    });
    const replayed = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: { 'idempotency-key': 'record-action-a' },
      payload: action,
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/cases/case:complaint-action-a/actions',
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      action: { ...action, caseId: 'case:complaint-action-a' },
      replayed: false,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual({ ...created.json(), replayed: true });
    expect(listed.json().actions).toEqual([created.json().action]);
  });

  it('rejects changed content under the same idempotency key and unknown cases', async () => {
    const app = buildApp();
    apps.push(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      headers: { 'idempotency-key': 'create-action-conflict-case' },
      payload: complaint,
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: { 'idempotency-key': 'record-action-conflict' },
      payload: action,
    });
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: { 'idempotency-key': 'record-action-conflict' },
      payload: { ...action, rationale: 'Changed rationale.' },
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:missing/actions',
      headers: { 'idempotency-key': 'missing-action-case' },
      payload: action,
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('CASE_ACTION_CONFLICT');
    expect(missing.statusCode).toBe(404);
  });
});
