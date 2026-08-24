import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

const provenance = (eventId: string) => ({
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL Forecast Lab',
  sourceEventId: eventId,
  observedAt: '2026-08-24T12:30:00.000Z',
  evidenceState: 'SIMULATED',
});

const strongGateDimension = (eventId: string) => ({
  sameAccountHistory: 0.9,
  connectedNetworkHistory: 0.85,
  graphConfidence: 0.9,
  historicalSupport: 0.85,
  predictionStability: 0.82,
  provenance: provenance(eventId),
});

const cashOutSignals = (eventId: string) => ({
  recentIncomingVelocity: 0.8,
  recentOutgoingVelocity: 0.85,
  historicalStationary: 0.03,
  historicalForward: 0.03,
  historicalCashOut: 0.94,
  cashOutTendency: 1,
  evidenceStrength: 1,
  provenance: provenance(eventId),
});

const stationarySignals = (eventId: string) => ({
  recentIncomingVelocity: 0.1,
  recentOutgoingVelocity: 0,
  historicalStationary: 0.8,
  historicalForward: 0.1,
  historicalCashOut: 0.1,
  cashOutTendency: 0.05,
  evidenceStrength: 0.8,
  provenance: provenance(eventId),
});

const weakGateDimension = (eventId: string) => ({
  sameAccountHistory: 0.15,
  connectedNetworkHistory: 0.2,
  graphConfidence: 0.55,
  historicalSupport: 0.3,
  predictionStability: 0.45,
  provenance: provenance(eventId),
});

const riskSignals = (eventId: string) => ({
  inflowSpike: 0.8,
  uniqueSenderSpike: 0.3,
  firstTimeSenderRatio: 0.4,
  behaviourShift: 0.7,
  crossCaseLinkage: 0,
  authorisedSharedIdentifierStrength: 0,
  provenance: provenance(eventId),
});

const timeHorizons = (eventPrefix: string) =>
  [
    ['UNDER_30_MIN', 0.3],
    ['30_TO_60_MIN', 0.5],
    ['1_TO_2_HOURS', 0.9],
    ['2_TO_6_HOURS', 0.6],
    ['6_TO_24_HOURS', 0.2],
  ].map(([bucket, score]) => ({
    bucket,
    features: {
      sameAccountDelayHistory: score,
      networkDelayHistory: score,
      amountSimilarity: score,
      velocityAlignment: score,
      temporalPattern: score,
      hopDepthSupport: score,
      similarCaseTiming: score,
    },
    provenance: provenance(`${eventPrefix}-${bucket}`),
  }));

const zoneFeatures = (score: number) => ({
  accountHistory: score,
  networkHistory: score,
  recency: score,
  timeSimilarity: score,
  amountSimilarity: score,
});

function forecastPayload(accountId: string, preferredZone: 'delhi' | 'noida', suffix: string) {
  const scores =
    preferredZone === 'delhi'
      ? { delhi: 0.95, noida: 0.65, ghaziabad: 0.45, gurugram: 0.25 }
      : { delhi: 0.55, noida: 0.98, ghaziabad: 0.5, gurugram: 0.3 };
  return {
    accountId,
    geoCandidates: [
      ['zone-delhi-east', 'Delhi East', scores.delhi],
      ['zone-noida-sector-62', 'Noida Sector 62', scores.noida],
      ['zone-ghaziabad', 'Ghaziabad', scores.ghaziabad],
      ['zone-gurugram', 'Gurugram', scores.gurugram],
    ].map(([zoneId, label, score]) => ({
      zoneId,
      label,
      features: zoneFeatures(score as number),
      provenance: provenance(`${suffix}-${zoneId}`),
    })),
    timeHorizons: timeHorizons(`${suffix}-time`),
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function prepareCase(
  app: ReturnType<typeof buildApp>,
  suffix: string,
  mode: 'SUPPORTED' | 'PARTIAL' | 'STATIONARY' = 'SUPPORTED',
) {
  const complaintId = `complaint-forecast-${suffix}`;
  const caseId = `case:${complaintId}`;
  const accountId = `acct-forecast-${suffix}`;
  const transactionId = `T-FORECAST-${suffix}`;
  await app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': `forecast-complaint-${suffix}` },
    payload: {
      complaintId,
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
    headers: { 'idempotency-key': `forecast-resolve-${suffix}` },
    payload: {
      eventId: `evt-forecast-resolve-${suffix}`,
      caseId,
      type: 'RESOLVE_TRANSACTION',
      occurredAt: '2026-08-24T10:15:00.000Z',
      provenance: provenance(`evt-forecast-resolve-${suffix}`),
      originalRef: transactionId,
      beneficiaryAccount: accountId,
      provider: 'TRISHUL Demo Bank',
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/provider-events`,
    headers: { 'idempotency-key': `forecast-events-${suffix}` },
    payload: {
      events: [
        {
          eventId: `evt-forecast-payment-${suffix}`,
          caseId,
          type: 'TRANSFER',
          occurredAt: '2026-08-24T10:00:00.000Z',
          provenance: provenance(`evt-forecast-payment-${suffix}`),
          transactionId,
          providerRef: `RRN-FORECAST-${suffix}`,
          fromAccount: `acct-payer-${suffix}`,
          toAccount: accountId,
          amount: { amountMinor: 5_000_000, currency: 'INR' },
        },
      ],
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/trace`,
    headers: { 'idempotency-key': `forecast-trace-${suffix}-v1` },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/recompute-exposure`,
    headers: { 'idempotency-key': `forecast-exposure-${suffix}-v1` },
    payload: {
      accountBalances: [
        {
          accountId,
          knownCleanBalanceMinor: 0,
          provenance: provenance(`forecast-balance-${suffix}-v1`),
        },
      ],
    },
  });
  await completePredictionPrerequisites(app, caseId, accountId, `${suffix}-v1`, mode);
  return { caseId, accountId };
}

async function completePredictionPrerequisites(
  app: ReturnType<typeof buildApp>,
  caseId: string,
  accountId: string,
  suffix: string,
  mode: 'SUPPORTED' | 'PARTIAL' | 'STATIONARY' = 'SUPPORTED',
) {
  await app.inject({
    method: 'POST',
    url: `/api/v1/accounts/${accountId}/risk`,
    headers: { 'idempotency-key': `forecast-risk-${suffix}` },
    payload: {
      caseId,
      providerSignals: riskSignals(`forecast-risk-${suffix}`),
      trustedOutcome: { status: 'NONE' },
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/exit-mode`,
    headers: { 'idempotency-key': `forecast-exit-${suffix}` },
    payload: {
      accountId,
      providerSignals:
        mode === 'STATIONARY'
          ? stationarySignals(`forecast-exit-${suffix}`)
          : cashOutSignals(`forecast-exit-${suffix}`),
    },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/forecast`,
    headers: { 'idempotency-key': `forecast-gate-${suffix}` },
    payload: {
      accountId,
      geo: strongGateDimension(`forecast-gate-geo-${suffix}`),
      time:
        mode === 'PARTIAL'
          ? weakGateDimension(`forecast-gate-time-${suffix}`)
          : strongGateDimension(`forecast-gate-time-${suffix}`),
    },
  });
}

describe('Phase 4 zone/time forecast and reforecast', () => {
  it('persists explainable top-3 zones and all five time buckets idempotently', async () => {
    const app = buildApp();
    apps.push(app);
    const { caseId, accountId } = await prepareCase(app, 'ranked');
    const payload = forecastPayload(accountId, 'delhi', 'ranked-v1');

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/predictions`,
      headers: { 'idempotency-key': 'ranked-prediction-v1' },
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/predictions`,
      headers: { 'idempotency-key': 'ranked-prediction-v1' },
      payload,
    });
    const latest = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/predictions/latest`,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().forecast).toMatchObject({
      graphVersion: 1,
      previousPredictionRunId: null,
      evidenceGateDecision: 'PREDICT',
      geo: { decision: 'PREDICT' },
      time: { decision: 'PREDICT', highestRiskBucket: '1_TO_2_HOURS' },
    });
    expect(first.json().forecast.geo.candidates).toHaveLength(3);
    expect(first.json().forecast.geo.candidates[0].zoneId).toBe('zone-delhi-east');
    expect(first.json().forecast.time.horizons).toHaveLength(5);
    expect(first.json().forecast.geo).not.toHaveProperty('endpointReference');
    expect(replay.json().replayed).toBe(true);
    expect(latest.json().forecast.predictionRunId).toBe(first.json().forecast.predictionRunId);

    const changedInputs = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/predictions`,
      headers: { 'idempotency-key': 'ranked-prediction-changed' },
      payload: forecastPayload(accountId, 'noida', 'ranked-changed'),
    });
    expect(changedInputs.statusCode).toBe(409);
    expect(changedInputs.json().error).toBe('FORECAST_VERSION_IMMUTABLE');
  });

  it('emits only the dimension that passed and persists full abstention explicitly', async () => {
    const app = buildApp();
    apps.push(app);
    const partial = await prepareCase(app, 'partial', 'PARTIAL');
    const partialPayload = forecastPayload(partial.accountId, 'delhi', 'partial-v1');
    const partialResult = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${partial.caseId}/predictions`,
      headers: { 'idempotency-key': 'partial-prediction-v1' },
      payload: { ...partialPayload, timeHorizons: [] },
    });

    const stationary = await prepareCase(app, 'stationary-output', 'STATIONARY');
    const withheld = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${stationary.caseId}/predictions`,
      headers: { 'idempotency-key': 'stationary-prediction-v1' },
      payload: {
        accountId: stationary.accountId,
        geoCandidates: [],
        timeHorizons: [],
      },
    });

    expect(partialResult.statusCode).toBe(200);
    expect(partialResult.json().forecast).toMatchObject({
      evidenceGateDecision: 'PARTIAL',
      geo: { decision: 'PREDICT' },
      time: { decision: 'ABSTAIN' },
    });
    expect(withheld.statusCode).toBe(200);
    expect(withheld.json().forecast).toMatchObject({
      exitMode: 'STATIONARY',
      evidenceGateDecision: 'ABSTAIN',
      geo: { decision: 'ABSTAIN' },
      time: { decision: 'ABSTAIN' },
      confidence: 0,
    });
  });

  it('invalidates stale output and links a reforecast after a new traced hop', async () => {
    const app = buildApp();
    apps.push(app);
    const { caseId, accountId } = await prepareCase(app, 'reforecast');
    const initial = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/predictions`,
      headers: { 'idempotency-key': 'reforecast-prediction-v1' },
      payload: forecastPayload(accountId, 'delhi', 'reforecast-v1'),
    });
    const nextAccountId = 'acct-forecast-reforecast-next';
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/provider-events`,
      headers: { 'idempotency-key': 'reforecast-next-hop' },
      payload: {
        events: [
          {
            eventId: 'evt-reforecast-next-hop',
            caseId,
            type: 'TRANSFER',
            occurredAt: '2026-08-24T10:35:00.000Z',
            provenance: provenance('evt-reforecast-next-hop'),
            transactionId: 'T-REFORCAST-NEXT',
            providerRef: 'RRN-REFORCAST-NEXT',
            fromAccount: accountId,
            toAccount: nextAccountId,
            amount: { amountMinor: 1_000_000, currency: 'INR' },
          },
        ],
      },
    });
    const retrace = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/trace`,
      headers: { 'idempotency-key': 'reforecast-trace-v2' },
    });
    const stale = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseId}/predictions/latest`,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/recompute-exposure`,
      headers: { 'idempotency-key': 'reforecast-exposure-v2' },
      payload: {
        accountBalances: [
          {
            accountId,
            knownCleanBalanceMinor: 0,
            provenance: provenance('reforecast-balance-root-v2'),
          },
          {
            accountId: nextAccountId,
            knownCleanBalanceMinor: 0,
            provenance: provenance('reforecast-balance-next-v2'),
          },
        ],
      },
    });
    await completePredictionPrerequisites(app, caseId, nextAccountId, 'reforecast-v2');
    const current = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseId}/predictions`,
      headers: { 'idempotency-key': 'reforecast-prediction-v2' },
      payload: forecastPayload(nextAccountId, 'noida', 'reforecast-v2'),
    });

    expect(retrace.json()).toMatchObject({ changed: true, graphVersion: 2 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('FORECAST_NOT_AVAILABLE');
    expect(initial.json().forecast.geo.candidates[0].zoneId).toBe('zone-delhi-east');
    expect(current.statusCode).toBe(200);
    expect(current.json().forecast).toMatchObject({
      graphVersion: 2,
      previousPredictionRunId: initial.json().forecast.predictionRunId,
      accountId: nextAccountId,
    });
    expect(current.json().forecast.reasonCodes).toContain('REFORECAST_AFTER_GRAPH_CHANGE');
    expect(current.json().forecast.geo.candidates[0].zoneId).toBe('zone-noida-sector-62');
  });
});
