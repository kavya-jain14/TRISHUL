import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('TRISHUL API foundation', () => {
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
      phase: 'PHASE_4_ZONE_TIME_REFORECAST',
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
      ]),
    );
  });
});
