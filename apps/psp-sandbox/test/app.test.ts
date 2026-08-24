import { afterEach, describe, expect, it } from 'vitest';
import { buildSandboxApp } from '../src/app.js';

const apps: ReturnType<typeof buildSandboxApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('deterministic PSP sandbox', () => {
  it('exposes both locked golden scenarios', async () => {
    const app = buildSandboxApp();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/scenarios' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.scenarios).toHaveLength(2);
    expect(
      body.scenarios.map((scenario: { expectedOutcome: string }) => scenario.expectedOutcome),
    ).toEqual(['PREDICT_AND_REFORECAST', 'ABSTAIN_AND_MONITOR']);
  });

  it('resets and replays the same first event', async () => {
    const app = buildSandboxApp();
    apps.push(app);
    const url = '/api/v1/scenarios/full-pipeline-reforecast/next';

    const first = (await app.inject({ method: 'POST', url })).json();
    await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios/full-pipeline-reforecast/reset',
    });
    const replayed = (await app.inject({ method: 'POST', url })).json();

    expect(first.event.eventId).toBe('evt-a-001-resolve');
    expect(replayed.event).toEqual(first.event);
  });

  it('returns not found for an unknown scenario', async () => {
    const app = buildSandboxApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios/missing/next',
    });

    expect(response.statusCode).toBe(404);
  });
});
