import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

const provenance = (eventId: string) => ({
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL Prediction Lab',
  sourceEventId: eventId,
  observedAt: '2026-08-24T12:30:00.000Z',
  evidenceState: 'SIMULATED',
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function prepareCase(
  app: ReturnType<typeof buildApp>,
  suffix: string,
  includeCashOut: boolean,
) {
  const caseId = `case:complaint-exit-${suffix}`;
  const accountId = `acct-exit-${suffix}`;
  const transactionId = `T-EXIT-${suffix}`;
  await app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': `exit-complaint-${suffix}` },
    payload: {
      complaintId: `complaint-exit-${suffix}`,
      originalTransactionRef: transactionId,
      reportedAmount: { amountMinor: 5_000_000, currency: 'INR' },
      transactionOccurredAt: '2026-08-24T10:00:00.000Z',
      reportedAt: '2026-08-24T10:15:00.000Z',
      category: 'IMPERSONATION',
      source: 'VICTIM',
      evidenceReferences: [],
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/resolve-transaction`,
    headers: { 'idempotency-key': `exit-resolve-${suffix}` },
    payload: {
      eventId: `evt-exit-resolve-${suffix}`,
      caseId,
      type: 'RESOLVE_TRANSACTION',
      occurredAt: '2026-08-24T10:15:00.000Z',
      provenance: provenance(`evt-exit-resolve-${suffix}`),
      originalRef: transactionId,
      beneficiaryAccount: accountId,
      provider: 'TRISHUL Demo Bank',
    },
  });
  const events: unknown[] = [
    {
      eventId: `evt-exit-payment-${suffix}`,
      caseId,
      type: 'TRANSFER',
      occurredAt: '2026-08-24T10:00:00.000Z',
      provenance: provenance(`evt-exit-payment-${suffix}`),
      transactionId,
      providerRef: `RRN-EXIT-${suffix}`,
      fromAccount: `acct-payer-${suffix}`,
      toAccount: accountId,
      amount: { amountMinor: 5_000_000, currency: 'INR' },
    },
  ];
  if (includeCashOut) {
    events.push({
      eventId: `evt-exit-cashout-${suffix}`,
      caseId,
      type: 'CASH_OUT',
      occurredAt: '2026-08-24T10:25:00.000Z',
      provenance: provenance(`evt-exit-cashout-${suffix}`),
      account: accountId,
      amount: { amountMinor: 3_000_000, currency: 'INR' },
      channel: 'ATM',
      zone: 'prediction-lab-zone',
      endpointReference: 'atm-prediction-lab-1',
    });
  }
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/provider-events`,
    headers: { 'idempotency-key': `exit-events-${suffix}` },
    payload: { events },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/trace`,
    headers: { 'idempotency-key': `exit-trace-${suffix}` },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/recompute-exposure`,
    headers: { 'idempotency-key': `exit-exposure-${suffix}` },
    payload: {
      accountBalances: [
        {
          accountId,
          knownCleanBalanceMinor: 0,
          provenance: provenance(`exit-balance-${suffix}`),
        },
      ],
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/accounts/${accountId}/risk`,
    headers: { 'idempotency-key': `exit-risk-${suffix}` },
    payload: {
      caseId,
      providerSignals: {
        inflowSpike: includeCashOut ? 0.8 : 0.1,
        uniqueSenderSpike: 0.1,
        firstTimeSenderRatio: 0.2,
        behaviourShift: includeCashOut ? 0.7 : 0.1,
        crossCaseLinkage: 0,
        authorisedSharedIdentifierStrength: 0,
        provenance: provenance(`exit-risk-signals-${suffix}`),
      },
      trustedOutcome: { status: 'NONE' },
    },
  });
  return { caseId, accountId };
}

const supportedExitSignals = (sourceEventId: string) => ({
  recentIncomingVelocity: 0.8,
  recentOutgoingVelocity: 0.85,
  historicalStationary: 0.03,
  historicalForward: 0.03,
  historicalCashOut: 0.94,
  cashOutTendency: 1,
  evidenceStrength: 1,
  provenance: provenance(sourceEventId),
});

const stationaryExitSignals = (sourceEventId: string) => ({
  recentIncomingVelocity: 0.1,
  recentOutgoingVelocity: 0,
  historicalStationary: 0.8,
  historicalForward: 0.1,
  historicalCashOut: 0.1,
  cashOutTendency: 0.05,
  evidenceStrength: 0.8,
  provenance: provenance(sourceEventId),
});

const strongGateDimension = (sourceEventId: string) => ({
  sameAccountHistory: 0.9,
  connectedNetworkHistory: 0.8,
  graphConfidence: 0.9,
  historicalSupport: 0.8,
  predictionStability: 0.82,
  provenance: provenance(sourceEventId),
});

const weakGateDimension = (sourceEventId: string) => ({
  sameAccountHistory: 0.15,
  connectedNetworkHistory: 0.2,
  graphConfidence: 0.55,
  historicalSupport: 0.3,
  predictionStability: 0.45,
  provenance: provenance(sourceEventId),
});

describe('exit mode and Evidence Gate vertical slice', () => {
  it('ranks cash-out and gates geo/time independently without inventing candidates', async () => {
    const app = buildApp();
    apps.push(app);
    const { caseId, accountId } = await prepareCase(app, 'supported', false);

    const prematureGate = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/forecast`,
      headers: { 'idempotency-key': 'supported-gate-premature' },
      payload: {
        accountId,
        geo: strongGateDimension('supported-geo-premature'),
        time: strongGateDimension('supported-time-premature'),
      },
    });
    const exitMode = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/exit-mode`,
      headers: { 'idempotency-key': 'supported-exit-v1' },
      payload: {
        accountId,
        providerSignals: supportedExitSignals('supported-exit-signals-v1'),
      },
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/exit-mode`,
      headers: { 'idempotency-key': 'supported-exit-v1' },
      payload: {
        accountId,
        providerSignals: supportedExitSignals('supported-exit-signals-v1'),
      },
    });
    const gate = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/forecast`,
      headers: { 'idempotency-key': 'supported-gate-v1' },
      payload: {
        accountId,
        geo: strongGateDimension('supported-geo-v1'),
        time: weakGateDimension('supported-time-v1'),
      },
    });
    const latest = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/forecast/latest`,
    });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}` });

    expect(prematureGate.statusCode).toBe(409);
    expect(prematureGate.json().error).toBe('EXIT_MODE_NOT_AVAILABLE');
    expect(exitMode.json().exitMode.selectedMode).toBe('CASH_OUT_LIKELY');
    expect(exitMode.json().exitMode.features).not.toHaveProperty('observedCashOut');
    expect(replay.json().replayed).toBe(true);
    expect(gate.json().evidenceGate).toMatchObject({
      overallDecision: 'PARTIAL',
      geo: { decision: 'PASS', coverageState: 'HIGH' },
      time: { decision: 'ABSTAIN' },
    });
    expect(gate.json().evidenceGate).not.toHaveProperty('geo.candidates');
    expect(latest.json().evidenceGate.evidenceGateRunId).toBe(
      gate.json().evidenceGate.evidenceGateRunId,
    );
    expect(detail.json().case.summary.state).toBe('PREDICT');
  });

  it('treats stationary funds and abstention as intentional valid states', async () => {
    const app = buildApp();
    apps.push(app);
    const { caseId, accountId } = await prepareCase(app, 'stationary', false);

    const exitMode = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/exit-mode`,
      headers: { 'idempotency-key': 'stationary-exit-v1' },
      payload: {
        accountId,
        providerSignals: stationaryExitSignals('stationary-exit-signals-v1'),
      },
    });
    const gate = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/forecast`,
      headers: { 'idempotency-key': 'stationary-gate-v1' },
      payload: {
        accountId,
        geo: strongGateDimension('stationary-geo-v1'),
        time: strongGateDimension('stationary-time-v1'),
      },
    });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}` });

    expect(exitMode.json().exitMode.selectedMode).toBe('STATIONARY');
    expect(gate.json().evidenceGate.overallDecision).toBe('ABSTAIN');
    expect(gate.json().evidenceGate.geo.missingEvidence).toContain('EXIT_MODE_NOT_CASH_OUT');
    expect(gate.json().evidenceGate.time.decision).toBe('ABSTAIN');
    expect(detail.json().case.summary.state).toBe('ABSTAIN');
  });

  it('rejects complaint-sourced prediction features', async () => {
    const app = buildApp();
    apps.push(app);
    const { caseId, accountId } = await prepareCase(app, 'source-boundary', false);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/exit-mode`,
      headers: { 'idempotency-key': 'complaint-exit-signals' },
      payload: {
        accountId,
        providerSignals: {
          ...stationaryExitSignals('complaint-exit-signals'),
          provenance: {
            ...provenance('complaint-exit-signals'),
            sourceType: 'COMPLAINT',
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('VALIDATION_ERROR');
  });

  it('invalidates current exit/gate outputs when TRACE advances', async () => {
    const app = buildApp();
    apps.push(app);
    const { caseId, accountId } = await prepareCase(app, 'invalidation', true);
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/exit-mode`,
      headers: { 'idempotency-key': 'invalidation-exit-v1' },
      payload: {
        accountId,
        providerSignals: supportedExitSignals('invalidation-exit-signals-v1'),
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/forecast`,
      headers: { 'idempotency-key': 'invalidation-gate-v1' },
      payload: {
        accountId,
        geo: strongGateDimension('invalidation-geo-v1'),
        time: strongGateDimension('invalidation-time-v1'),
      },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'invalidation-next-hop' },
      payload: {
        events: [
          {
            eventId: 'evt-invalidation-next-hop',
            caseId,
            type: 'TRANSFER',
            occurredAt: '2026-08-24T10:35:00.000Z',
            provenance: provenance('evt-invalidation-next-hop'),
            transactionId: 'T-INVALIDATION-NEXT',
            providerRef: 'RRN-INVALIDATION-NEXT',
            fromAccount: accountId,
            toAccount: 'acct-invalidation-next',
            amount: { amountMinor: 1_000_000, currency: 'INR' },
          },
        ],
      },
    });
    const retrace = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/trace`,
      headers: { 'idempotency-key': 'invalidation-trace-v2' },
    });
    const staleExit = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/exit-mode/latest`,
    });
    const staleGate = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/forecast/latest`,
    });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/cases/${caseId}` });

    expect(retrace.json()).toMatchObject({ changed: true, graphVersion: 2 });
    expect(staleExit.json().error).toBe('EXIT_MODE_NOT_AVAILABLE');
    expect(staleGate.json().error).toBe('EVIDENCE_GATE_NOT_AVAILABLE');
    expect(detail.json().case.summary.state).toBe('TRACE');
  });
});
