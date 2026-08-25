import { LeaseLostError, type OutboxClaim, type OutboxJobType } from '@trishul/database';
import { describe, expect, test } from 'vitest';
import type { StructuredLogger } from '../src/logger.js';
import { DurableWorkerRuntime, type WorkerQueue } from '../src/runtime.js';

const claim: OutboxClaim = {
  jobId: 'job-1',
  type: 'ALERT_DISPATCH',
  payload: { caseId: 'case-1' },
  idempotencyKey: 'alert:case-1',
  status: 'PROCESSING',
  availableAt: '2026-08-24T10:00:00.000Z',
  createdAt: '2026-08-24T10:00:00.000Z',
  maxAttempts: 3,
  failureCount: 0,
  workerId: 'worker-1',
  lockToken: '00000000-0000-4000-8000-000000000001',
  leaseExpiresAt: '2026-08-24T10:00:30.000Z',
};

class FakeQueue implements WorkerQueue {
  next: OutboxClaim | null = structuredClone(claim);
  completionTime: string | null = null;
  loseOnComplete = false;
  failureCount = 0;

  async claimNext(_type: OutboxJobType) {
    const next = this.next;
    this.next = null;
    return next;
  }
  async heartbeat(current: OutboxClaim) {
    return current;
  }
  async succeed(_claim: OutboxClaim, completedAt: string) {
    if (this.loseOnComplete) throw new LeaseLostError(claim.jobId);
    this.completionTime = completedAt;
  }
  async fail() {
    this.failureCount += 1;
    return 'RETRY_SCHEDULED' as const;
  }
  async metrics() {
    return {
      counts: { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 },
      openDeadLetters: 0,
      oldestPendingAgeMs: null,
    };
  }
}

const logger: StructuredLogger = { log() {} };
const config = {
  workerId: 'worker-1',
  pollIntervalMs: 10_000,
  leaseMs: 30_000,
  heartbeatIntervalMs: 10_000,
  metricsIntervalMs: 30_000,
};

describe('DurableWorkerRuntime', () => {
  test('uses actual completion time instead of the claim timestamp', async () => {
    const queue = new FakeQueue();
    const times = [new Date('2026-08-24T10:00:00.000Z'), new Date('2026-08-24T10:00:01.500Z')];
    const runtime = new DurableWorkerRuntime(
      queue,
      { ALERT_DISPATCH: async () => undefined },
      logger,
      config,
      () => times.shift() ?? times.at(-1)!,
    );
    expect(await runtime.processOne('ALERT_DISPATCH')).toBe('PROCESSED');
    expect(queue.completionTime).toBe('2026-08-24T10:00:01.500Z');
  });

  test('reports lease loss instead of completing a reclaimed job', async () => {
    const queue = new FakeQueue();
    queue.loseOnComplete = true;
    const runtime = new DurableWorkerRuntime(
      queue,
      { ALERT_DISPATCH: async () => undefined },
      logger,
      config,
      () => new Date('2026-08-24T10:00:00.000Z'),
    );
    expect(await runtime.processOne('ALERT_DISPATCH')).toBe('LEASE_LOST');
  });

  test('stops a polling loop promptly when shutdown is requested', async () => {
    const queue = new FakeQueue();
    queue.next = null;
    const runtime = new DurableWorkerRuntime(
      queue,
      { ALERT_DISPATCH: async () => undefined },
      logger,
      config,
    );
    const controller = new AbortController();
    const running = runtime.run(controller.signal);
    controller.abort('test shutdown');
    await expect(running).resolves.toBeUndefined();
  });

  test('aborts an in-flight handler on shutdown without consuming a retry', async () => {
    const queue = new FakeQueue();
    let started!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = new DurableWorkerRuntime(
      queue,
      {
        ALERT_DISPATCH: async (_payload, context) => {
          started();
          await new Promise<void>((_resolve, reject) => {
            const abort = () => reject(new Error('request aborted'));
            if (context.signal.aborted) abort();
            else context.signal.addEventListener('abort', abort, { once: true });
          });
        },
      },
      logger,
      config,
    );
    const controller = new AbortController();
    const processing = runtime.processOne('ALERT_DISPATCH', controller.signal);
    await handlerStarted;
    controller.abort('test shutdown');

    await expect(processing).resolves.toBe('LEASE_LOST');
    expect(queue.failureCount).toBe(0);
  });
});
