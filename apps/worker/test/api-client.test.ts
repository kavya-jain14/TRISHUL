import type { ForecastRefreshJob } from '@trishul/contracts';
import { describe, expect, test, vi } from 'vitest';
import { TrishulApiClient } from '../src/api-client.js';

describe('TrishulApiClient', () => {
  test('dispatches idempotent operations without leaking the service token', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const client = new TrishulApiClient('https://api.example.test/root/', 'secret-token', request);

    await client.trace({ caseId: 'case:worker-a', idempotencyKey: 'trace-worker-a' });

    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/root/api/v1/cases/case%3Aworker-a/trace');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer secret-token',
        'idempotency-key': 'trace-worker-a',
      },
    });
    expect(init?.body).toBeUndefined();
  });

  test('runs all three reforecast stages in canonical order', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const client = new TrishulApiClient('http://127.0.0.1:4000', undefined, request, {
      allowInsecureHttp: true,
    });
    const job = {
      caseId: 'case-forecast-worker',
      exitMode: { idempotencyKey: 'exit-key', request: { accountId: 'acct-1' } },
      evidenceGate: { idempotencyKey: 'gate-key', request: { accountId: 'acct-1' } },
      forecast: { idempotencyKey: 'forecast-key', request: { accountId: 'acct-1' } },
    } as unknown as ForecastRefreshJob;

    await client.refreshForecast(job);

    expect(request.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/v1/cases/case-forecast-worker/exit-mode',
      '/api/v1/cases/case-forecast-worker/forecast',
      '/api/v1/cases/case-forecast-worker/predictions',
    ]);
    expect(
      request.mock.calls.map(
        ([, init]) => (init?.headers as Record<string, string>)['idempotency-key'],
      ),
    ).toEqual(['exit-key', 'gate-key', 'forecast-key']);
  });

  test('rejects unsafe base protocols and reports API failures without response content', async () => {
    expect(() => new TrishulApiClient('file:///tmp/trishul')).toThrow(/HTTPS/);
    expect(() => new TrishulApiClient('http://api.example.test')).toThrow(/HTTPS/);
    expect(
      () =>
        new TrishulApiClient('http://api.example.test', undefined, fetch, {
          allowInsecureHttp: true,
        }),
    ).toThrow(/HTTPS/);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"private":"do-not-log"}', { status: 503 }));
    const client = new TrishulApiClient('https://api.example.test', undefined, request);

    await expect(
      client.trace({ caseId: 'case-failure', idempotencyKey: 'trace-failure' }),
    ).rejects.toThrow('HTTP 503');
    await expect(
      client.trace({ caseId: 'case-failure', idempotencyKey: 'trace-failure' }),
    ).rejects.not.toThrow(/do-not-log/);
  });

  test('bounds hung requests and propagates a caller abort', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(new DOMException('aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        }),
    );
    const timedClient = new TrishulApiClient('https://api.example.test', undefined, request, {
      timeoutMs: 5,
    });
    await expect(
      timedClient.trace({ caseId: 'case-timeout', idempotencyKey: 'trace-timeout' }),
    ).rejects.toThrow(/timed out after 5ms/);

    const controller = new AbortController();
    controller.abort('lease lost');
    const abortClient = new TrishulApiClient('https://api.example.test', undefined, request, {
      timeoutMs: 1_000,
    });
    await expect(
      abortClient.trace({ caseId: 'case-abort', idempotencyKey: 'trace-abort' }, controller.signal),
    ).rejects.toThrow(/was aborted/);
  });
});
