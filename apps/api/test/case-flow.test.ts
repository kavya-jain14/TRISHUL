import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
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

const provenance = (eventId: string) => ({
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL PSP Sandbox',
  sourceEventId: eventId,
  observedAt: '2026-08-24T10:20:00.000Z',
  evidenceState: 'SIMULATED',
});

const resolution = {
  eventId: 'evt-resolve-a',
  caseId,
  type: 'RESOLVE_TRANSACTION',
  occurredAt: '2026-08-24T10:15:00.000Z',
  provenance: provenance('evt-resolve-a'),
  originalRef: 'T1001',
  beneficiaryAccount: 'acct-a',
  provider: 'TRISHUL Demo Bank',
};

const originalTransfer = {
  eventId: 'evt-payment-a',
  caseId,
  type: 'TRANSFER',
  occurredAt: '2026-08-24T10:00:00.000Z',
  provenance: provenance('evt-payment-a'),
  transactionId: 'T1001',
  providerRef: 'RRN1001',
  fromAccount: 'acct-kavya',
  toAccount: 'acct-a',
  amount: { amountMinor: 5_000_000, currency: 'INR' },
};

const downstreamTransfer = {
  eventId: 'evt-a-to-b',
  caseId,
  type: 'TRANSFER',
  occurredAt: '2026-08-24T10:08:00.000Z',
  provenance: provenance('evt-a-to-b'),
  transactionId: 'T1002',
  providerRef: 'RRN1002',
  fromAccount: 'acct-a',
  toAccount: 'acct-b',
  amount: { amountMinor: 3_500_000, currency: 'INR' },
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createReportedCase(app: ReturnType<typeof buildApp>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': 'complaint-create-a' },
    payload: complaint,
  });
}

async function resolveReportedCase(app: ReturnType<typeof buildApp>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/resolve-transaction`,
    headers: { 'idempotency-key': 'resolve-a' },
    payload: resolution,
  });
}

describe('complaint-to-trace vertical slice', () => {
  it('requires an idempotency key on every write', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      payload: complaint,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('replays the same complaint and rejects idempotency-key payload changes', async () => {
    const app = buildApp();
    apps.push(app);

    const created = await createReportedCase(app);
    const replay = await createReportedCase(app);
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      headers: { 'idempotency-key': 'complaint-create-a' },
      payload: { ...complaint, category: 'PAYMENT_FRAUD' },
    });

    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().case.summary.caseId).toBe(caseId);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires transaction resolution before downstream ingestion', async () => {
    const app = buildApp();
    apps.push(app);
    await createReportedCase(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'events-before-resolution' },
      payload: { events: [originalTransfer] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('CASE_NOT_RESOLVED');
  });

  it('rejects a transaction resolver mismatch', async () => {
    const app = buildApp();
    apps.push(app);
    await createReportedCase(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/resolve-transaction`,
      headers: { 'idempotency-key': 'resolve-mismatch' },
      payload: { ...resolution, originalRef: 'WRONG-TX' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('TRANSACTION_REFERENCE_MISMATCH');
  });

  it('builds a chronological provenance-backed graph from out-of-order events', async () => {
    const app = buildApp();
    apps.push(app);
    await createReportedCase(app);
    await resolveReportedCase(app);

    const ingestion = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'events-a-batch-1' },
      payload: { events: [downstreamTransfer, originalTransfer] },
    });
    const trace = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/trace`,
      headers: { 'idempotency-key': 'trace-a-v1' },
    });
    const graph = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/graph`,
    });

    expect(ingestion.statusCode).toBe(200);
    expect(ingestion.json().acceptedEventIds).toEqual(['evt-a-to-b', 'evt-payment-a']);
    expect(trace.json()).toMatchObject({ changed: true, graphVersion: 1, edgeCount: 2 });
    expect(graph.statusCode).toBe(200);
    expect(graph.json().graph.edges.map((edge: { edgeId: string }) => edge.edgeId)).toEqual([
      'edge:evt-payment-a',
      'edge:evt-a-to-b',
    ]);
    expect(graph.json().graph.edges[0].provenance).toMatchObject({
      sourceType: 'SIMULATOR',
      sourceEventId: 'evt-payment-a',
    });
    expect(graph.json().graph.coverageBoundary).toContain('acct-b');
  });

  it('does not duplicate ledger events, graph edges, or graph versions on replay', async () => {
    const app = buildApp();
    apps.push(app);
    await createReportedCase(app);
    await resolveReportedCase(app);

    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'events-a-first' },
      payload: { events: [originalTransfer] },
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'events-a-duplicate' },
      payload: { events: [originalTransfer] },
    });
    const firstTrace = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/trace`,
      headers: { 'idempotency-key': 'trace-a-first' },
    });
    const sameKeyReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/trace`,
      headers: { 'idempotency-key': 'trace-a-first' },
    });
    const newTraceRequest = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/trace`,
      headers: { 'idempotency-key': 'trace-a-second' },
    });

    expect(duplicate.json()).toMatchObject({
      acceptedEventIds: [],
      duplicateEventIds: ['evt-payment-a'],
      totalLedgerEvents: 2,
    });
    expect(firstTrace.json()).toMatchObject({ changed: true, graphVersion: 1, edgeCount: 1 });
    expect(sameKeyReplay.json()).toMatchObject({ replayed: true, graphVersion: 1 });
    expect(newTraceRequest.json()).toMatchObject({
      changed: false,
      replayed: false,
      graphVersion: 1,
      edgeCount: 1,
    });
  });

  it('rejects provenance-free events and conflicting event-ID replays', async () => {
    const app = buildApp();
    apps.push(app);
    await createReportedCase(app);
    await resolveReportedCase(app);

    const noProvenance = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'events-no-provenance' },
      payload: { events: [{ ...originalTransfer, provenance: undefined }] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'events-valid' },
      payload: { events: [originalTransfer] },
    });
    const conflictingReplay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'events-conflicting-replay' },
      payload: {
        events: [
          {
            ...originalTransfer,
            amount: { amountMinor: 4_900_000, currency: 'INR' },
          },
        ],
      },
    });

    expect(noProvenance.statusCode).toBe(400);
    expect(noProvenance.json().error).toBe('VALIDATION_ERROR');
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json().error).toBe('PROVIDER_EVENT_CONFLICT');
  });

  it('returns an intentional pre-trace graph state instead of fabricated data', async () => {
    const app = buildApp();
    apps.push(app);
    await createReportedCase(app);
    await resolveReportedCase(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/graph`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('GRAPH_NOT_AVAILABLE');
  });
});
