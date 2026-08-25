import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const provenance = {
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL Demo Bank',
  sourceEventId: 'risk-signal:api-golden',
  observedAt: '2026-08-25T04:30:00.000Z',
  evidenceState: 'SIMULATED',
};

const request = {
  paymentReference: 'payment:api-golden',
  payerReference: 'acct:kavya',
  receiverReference: 'acct:receiver-a',
  amount: { amountMinor: 500_000, currency: 'INR' },
  occurredAt: '2026-08-25T04:30:00.000Z',
  payerSignals: {
    priorSuccessfulPaymentsToReceiver: 0,
    amountBaseline: {
      medianMinor: 100_000,
      medianAbsoluteDeviationMinor: 10_000,
      sampleSize: 20,
    },
    transactionsLast10Minutes: 1,
    baselineTransactionsPer10Minutes: 1,
    usualActiveHoursUtc: { startHourUtc: 3, endHourUtc: 18 },
    deviceStatus: 'KNOWN_TRUSTED',
    provenance,
  },
  receiverSignals: {
    trustStatus: 'VERIFIED',
    inflowSpike: 0.1,
    uniqueSenderSpike: 0.1,
    passThroughRisk: 0.05,
    behaviourShift: 0.1,
    provenance,
  },
  networkSignals: {
    reportedNetworkProximity: 0,
    crossCaseLinkage: 0,
    trustedExternalIntelligence: 0,
    provenance,
  },
  stepUp: { status: 'NOT_PERFORMED' },
};

describe('TRINETRA payment risk API', () => {
  it('persists an explainable assessment and replays it idempotently', async () => {
    const app = buildApp();
    apps.push(app);
    const submit = (payload: Record<string, unknown> = request) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/risk/evaluate',
        headers: { 'idempotency-key': 'risk:api-golden' },
        payload,
      });

    const created = await submit();
    const replayed = await submit();
    const latest = await app.inject({
      method: 'GET',
      url: '/api/v1/risk/evaluations/payment:api-golden/latest',
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      assessment: {
        paymentReference: 'payment:api-golden',
        trustStatus: 'VERIFIED',
        decision: 'STEP_UP',
        muleState: 'NORMAL',
      },
      replayed: false,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual({ ...created.json(), replayed: true });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().assessment).toEqual(created.json().assessment);

    const conflict = await submit({
      ...request,
      amount: { amountMinor: 700_000, currency: 'INR' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('PAYMENT_RISK_IDEMPOTENCY_CONFLICT');
  });

  it('fails closed behind the internal provider service-token boundary', async () => {
    const app = buildApp({
      enforcePaymentRiskServiceToken: true,
      paymentRiskServiceToken: 'risk-service-token-abcdefghijklmnopqrstuvwxyz',
    });
    apps.push(app);
    const submit = (token?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/risk/evaluate',
        headers: {
          'idempotency-key': 'risk:protected-api',
          ...(token ? { 'x-trishul-service-token': token } : {}),
        },
        payload: request,
      });

    expect((await submit()).statusCode).toBe(401);
    expect((await submit('wrong-service-token')).statusCode).toBe(401);
    expect((await submit('risk-service-token-abcdefghijklmnopqrstuvwxyz')).statusCode).toBe(201);
  });

  it('rejects client-invented fields and complaint-sourced behavioural signals', async () => {
    const app = buildApp();
    apps.push(app);
    const submit = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/risk/evaluate',
        headers: { 'idempotency-key': 'risk:invalid-provider-signal' },
        payload,
      });

    const unknownField = await submit({ ...request, claimedIntent: 'safe' });
    const complaintSignal = await submit({
      ...request,
      receiverSignals: {
        ...request.receiverSignals,
        provenance: { ...provenance, sourceType: 'COMPLAINT' },
      },
    });
    const impossibleStepUp = await submit({
      ...request,
      stepUp: {
        status: 'VERIFIED',
        verificationReference: 'step-up:predates-payment',
        verifiedAt: '2026-08-25T04:29:59.000Z',
        provenance,
      },
    });

    expect(unknownField.statusCode).toBe(400);
    expect(complaintSignal.statusCode).toBe(400);
    expect(impossibleStepUp.statusCode).toBe(400);
  });
});
