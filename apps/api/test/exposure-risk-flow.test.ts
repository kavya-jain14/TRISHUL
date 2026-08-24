import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
const caseId = 'case:complaint-exposure-a';

const provenance = (eventId: string) => ({
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL PSP Sandbox',
  sourceEventId: eventId,
  observedAt: '2026-08-24T10:20:00.000Z',
  evidenceState: 'SIMULATED',
});

const complaint = {
  complaintId: 'complaint-exposure-a',
  originalTransactionRef: 'T-EXPOSURE-1',
  reportedAmount: { amountMinor: 5_000_000, currency: 'INR' },
  transactionOccurredAt: '2026-08-24T10:00:00.000Z',
  reportedAt: '2026-08-24T10:15:00.000Z',
  category: 'IMPERSONATION',
  source: 'VICTIM',
  evidenceReferences: [],
};

const resolution = {
  eventId: 'evt-exposure-resolve',
  caseId,
  type: 'RESOLVE_TRANSACTION',
  occurredAt: '2026-08-24T10:15:00.000Z',
  provenance: provenance('evt-exposure-resolve'),
  originalRef: 'T-EXPOSURE-1',
  beneficiaryAccount: 'acct-a',
  provider: 'TRISHUL Demo Bank',
};

const events = [
  {
    eventId: 'evt-exposure-payment',
    caseId,
    type: 'TRANSFER',
    occurredAt: '2026-08-24T10:00:00.000Z',
    provenance: provenance('evt-exposure-payment'),
    transactionId: 'T-EXPOSURE-1',
    providerRef: 'RRN-EXPOSURE-1',
    fromAccount: 'acct-victim',
    toAccount: 'acct-a',
    amount: { amountMinor: 5_000_000, currency: 'INR' },
  },
  {
    eventId: 'evt-exposure-forward',
    caseId,
    type: 'TRANSFER',
    occurredAt: '2026-08-24T10:08:00.000Z',
    provenance: provenance('evt-exposure-forward'),
    transactionId: 'T-EXPOSURE-2',
    providerRef: 'RRN-EXPOSURE-2',
    fromAccount: 'acct-a',
    toAccount: 'acct-b',
    amount: { amountMinor: 3_000_000, currency: 'INR' },
  },
];

const exposureEvidence = {
  accountBalances: [
    {
      accountId: 'acct-a',
      knownCleanBalanceMinor: 2_000_000,
      provenance: provenance('balance-acct-a-v1'),
    },
    {
      accountId: 'acct-b',
      knownCleanBalanceMinor: 0,
      provenance: provenance('balance-acct-b-v1'),
    },
  ],
};

const riskEvidence = {
  caseId,
  providerSignals: {
    inflowSpike: 0.8,
    uniqueSenderSpike: 0.7,
    firstTimeSenderRatio: 0.8,
    behaviourShift: 0.75,
    crossCaseLinkage: 0.7,
    authorisedSharedIdentifierStrength: 0.6,
    provenance: provenance('risk-signals-acct-a-v1'),
  },
  trustedOutcome: { status: 'NONE' },
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function tracedCase(app: ReturnType<typeof buildApp>) {
  await app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': 'exposure-complaint' },
    payload: complaint,
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/resolve-transaction`,
    headers: { 'idempotency-key': 'exposure-resolve' },
    payload: resolution,
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/provider-events`,
    headers: { 'idempotency-key': 'exposure-events' },
    payload: { events },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/trace`,
    headers: { 'idempotency-key': 'exposure-trace' },
  });
}

describe('exposure and mule/network risk vertical slice', () => {
  it('stores the locked commingling range once per immutable graph version', async () => {
    const app = buildApp();
    apps.push(app);
    await tracedCase(app);

    const calculated = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'exposure-v1' },
      payload: exposureEvidence,
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'exposure-v1' },
      payload: exposureEvidence,
    });
    const conflictingEvidence = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'exposure-v1-changed' },
      payload: {
        accountBalances: exposureEvidence.accountBalances.map((balance) =>
          balance.accountId === 'acct-a'
            ? { ...balance, knownCleanBalanceMinor: 1_900_000 }
            : balance,
        ),
      },
    });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}` });

    const accountA = calculated
      .json()
      .exposure.states.find((state: { accountId: string }) => state.accountId === 'acct-a');
    expect(calculated.statusCode).toBe(200);
    expect(accountA).toMatchObject({
      observedOutgoingMinor: 3_000_000,
      fraudLinkedBalanceMinor: 5_000_000,
      knownCleanBalanceMinor: 2_000_000,
      minimumAttributableMinor: 1_000_000,
      maximumAttributableMinor: 3_000_000,
    });
    expect(replay.json().replayed).toBe(true);
    expect(conflictingEvidence.statusCode).toBe(409);
    expect(conflictingEvidence.json().error).toBe('EXPOSURE_VERSION_IMMUTABLE');
    expect(detail.json().case.summary.state).toBe('EXPOSURE');
    expect(detail.json().case.latestExposureGraphVersion).toBe(1);
  });

  it('requires current exposure and never confirms from behavioural signals alone', async () => {
    const app = buildApp();
    apps.push(app);
    await tracedCase(app);

    const premature = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/acct-a/risk',
      headers: { 'idempotency-key': 'risk-before-exposure' },
      payload: riskEvidence,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'risk-exposure-v1' },
      payload: exposureEvidence,
    });
    const assessed = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/acct-a/risk',
      headers: { 'idempotency-key': 'risk-acct-a-v1' },
      payload: riskEvidence,
    });
    const snapshots = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/risk-snapshots`,
    });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}` });

    expect(premature.statusCode).toBe(409);
    expect(premature.json().error).toBe('EXPOSURE_NOT_AVAILABLE');
    expect(assessed.statusCode).toBe(200);
    expect(assessed.json().assessment.state).not.toBe('CONFIRMED');
    expect(assessed.json().assessment.features.movement.rapidForwarding).toBe(1);
    expect(snapshots.json().assessments).toHaveLength(1);
    expect(detail.json().case.summary.state).toBe('RISK_ASSESSED');
  });

  it('rejects unreferenced confirmation and complaint-sourced risk features', async () => {
    const app = buildApp();
    apps.push(app);
    await tracedCase(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'validation-exposure-v1' },
      payload: exposureEvidence,
    });

    const missingReference = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/acct-a/risk',
      headers: { 'idempotency-key': 'unreferenced-confirmation' },
      payload: { ...riskEvidence, trustedOutcome: { status: 'CONFIRMED' } },
    });
    const complaintSignals = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/acct-a/risk',
      headers: { 'idempotency-key': 'complaint-risk-signals' },
      payload: {
        ...riskEvidence,
        providerSignals: {
          ...riskEvidence.providerSignals,
          provenance: {
            ...riskEvidence.providerSignals.provenance,
            sourceType: 'COMPLAINT',
          },
        },
      },
    });
    const trustedConfirmation = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/acct-a/risk',
      headers: { 'idempotency-key': 'trusted-confirmation' },
      payload: {
        ...riskEvidence,
        trustedOutcome: {
          status: 'CONFIRMED',
          institutionalReference: 'bank-outcome-confirmed-001',
        },
      },
    });

    expect(missingReference.statusCode).toBe(400);
    expect(missingReference.json().error).toBe('VALIDATION_ERROR');
    expect(complaintSignals.statusCode).toBe(400);
    expect(complaintSignals.json().error).toBe('VALIDATION_ERROR');
    expect(trustedConfirmation.statusCode).toBe(200);
    expect(trustedConfirmation.json().assessment).toMatchObject({
      state: 'CONFIRMED',
      trustedOutcome: {
        status: 'CONFIRMED',
        institutionalReference: 'bank-outcome-confirmed-001',
      },
    });
  });

  it('invalidates current derived intelligence when TRACE advances the graph', async () => {
    const app = buildApp();
    apps.push(app);
    await tracedCase(app);
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'invalidation-exposure-v1' },
      payload: exposureEvidence,
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/acct-a/risk',
      headers: { 'idempotency-key': 'invalidation-risk-v1' },
      payload: riskEvidence,
    });

    const nextHop = {
      eventId: 'evt-exposure-b-to-c',
      caseId,
      type: 'TRANSFER',
      occurredAt: '2026-08-24T10:12:00.000Z',
      provenance: provenance('evt-exposure-b-to-c'),
      transactionId: 'T-EXPOSURE-3',
      providerRef: 'RRN-EXPOSURE-3',
      fromAccount: 'acct-b',
      toAccount: 'acct-c',
      amount: { amountMinor: 2_000_000, currency: 'INR' },
    };
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'invalidation-next-hop' },
      payload: { events: [nextHop] },
    });
    const retrace = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/trace`,
      headers: { 'idempotency-key': 'invalidation-trace-v2' },
    });
    const staleExposure = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/exposure`,
    });
    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/risk-snapshots`,
    });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}` });

    expect(retrace.json()).toMatchObject({ changed: true, graphVersion: 2 });
    expect(staleExposure.statusCode).toBe(409);
    expect(staleExposure.json().error).toBe('EXPOSURE_NOT_AVAILABLE');
    expect(history.json().assessments).toHaveLength(1);
    expect(history.json().assessments[0].graphVersion).toBe(1);
    expect(detail.json().case.summary.state).toBe('TRACE');
  });
});
