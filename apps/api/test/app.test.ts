import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('TRISHUL API foundation', () => {
  it.each([
    {
      name: 'malformed JSON',
      contentType: 'application/json',
      payload: '{"private-complaint-marker":',
      status: 400,
      code: 'INVALID_JSON_BODY',
    },
    {
      name: 'an empty JSON body',
      contentType: 'application/json',
      payload: '',
      status: 400,
      code: 'INVALID_JSON_BODY',
    },
    {
      name: 'an oversized body',
      contentType: 'application/json',
      payload: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    },
    {
      name: 'an unsupported content type',
      contentType: 'application/xml',
      payload: '<private-complaint-marker/>',
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    },
  ])('rejects $name with a safe client error', async ({ contentType, payload, status, code }) => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      headers: { 'content-type': contentType, 'idempotency-key': 'invalid-request' },
      payload,
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: code, message: expect.any(String) });
    expect(response.body).not.toContain('private-complaint-marker');
  });

  it('keeps unexpected errors private even when they carry a client status', async () => {
    const app = buildApp();
    apps.push(app);
    app.get('/unexpected-error', async () => {
      throw Object.assign(new Error('private-internal-marker'), { statusCode: 400 });
    });

    const response = await app.inject({ method: 'GET', url: '/unexpected-error' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
    });
  });

  it('reports health', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'trishul-api' });
  });

  it('publishes the locked doctrine', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/system/manifest' });

    expect(response.statusCode).toBe(200);
    expect(response.json().doctrine).toEqual({
      intentInference: false,
      complaintAsBlacklist: false,
      provenanceRequired: true,
      predictionCanAbstain: true,
    });
    expect(response.json()).toMatchObject({
      phase: 'PHASE_7_COMMAND_CENTER_ALERTS',
      trustAccessMode: 'OPTIONAL_DEVELOPMENT_ADAPTER',
    });
    expect(response.json().capabilities).toEqual(
      expect.arrayContaining([
        'VERSIONED_EXIT_MODE',
        'INDEPENDENT_EVIDENCE_GATE',
        'INTENTIONAL_ABSTENTION',
        'TOP_K_GEO_FORECAST',
        'TIME_HORIZON_FORECAST',
        'VERSIONED_REFORECAST',
        'DURABLE_CASE_ACTION_EVENTS',
        'PII_FREE_EVIDENCE_ANCHORING',
        'TAMPER_EVIDENT_VERIFICATION',
        'REPLACEABLE_BLOCKCHAIN_PROVIDER',
        'ISSUER_SIGNED_CREDENTIALS',
        'SUBJECT_BOUND_CHALLENGE_PROOF',
        'CAPABILITY_AND_CASE_SCOPED_ACCESS',
        'REPLAY_SAFE_NONCE_VERIFICATION',
        'EXPLAINABLE_PRE_PAYMENT_RISK',
        'PAYER_STEP_UP_DECISION',
        'TRUST_RISK_SEPARATION',
        'DURABLE_PAYMENT_RISK_HISTORY',
        'CROSS_CASE_NETWORK_MEMORY',
        'OPAQUE_CASE_CORRELATION',
        'TRUSTED_OUTCOME_WEIGHTING',
        'INTERNAL_CORRELATION_TO_MULE_RISK',
        'DETERMINISTIC_CASE_PRIORITY',
        'OPERATIONAL_INTERVENTION_STATES',
        'TRUST_SCOPED_COMMAND_CENTER',
        'DURABLE_ALERT_LIFECYCLE',
      ]),
    );
  });
});
