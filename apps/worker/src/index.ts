import { randomUUID } from 'node:crypto';
import {
  PostgresAlertRepository,
  PostgresOutboxRepository,
  type OutboxJobType,
} from '@trishul/database';
import { Pool } from 'pg';
import { TrishulApiClient } from './api-client.js';
import { createDomainHandlers } from './domain-handlers.js';
import { JsonStructuredLogger } from './logger.js';
import { DurableWorkerRuntime, type JobHandler } from './runtime.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error('DATABASE_URL is required to run the durable TRISHUL worker.');

const logger = new JsonStructuredLogger('trishul-worker');
const pool = new Pool({ connectionString });
const queue = new PostgresOutboxRepository(pool);
const alerts = new PostgresAlertRepository(pool);
const workerId = process.env.WORKER_ID ?? `trishul-worker-${randomUUID()}`;
const pollIntervalMs = positiveInteger('WORKER_POLL_MS', 1_000);
const leaseMs = positiveInteger('WORKER_LEASE_MS', 30_000);
const heartbeatIntervalMs = positiveInteger('WORKER_HEARTBEAT_MS', 10_000);
const metricsIntervalMs = positiveInteger('WORKER_METRICS_MS', 30_000);
const operations = new TrishulApiClient(
  process.env.TRISHUL_API_BASE_URL ?? 'http://127.0.0.1:4000',
  process.env.TRISHUL_INTERNAL_SERVICE_TOKEN,
);

const handlers: Partial<Record<OutboxJobType, JobHandler>> = {
  ...createDomainHandlers(operations, logger),
  ALERT_DISPATCH: async (payload, context) => {
    if (context.signal.aborted) throw new Error('Alert dispatch was aborted after lease loss.');
    const result = await alerts.persist(payload);
    logger.log('info', 'alert_dispatched', {
      deliveryMode: 'STRUCTURED_LOG_DEVELOPMENT_ADAPTER',
      alertId: result.alert.alertId,
      caseId: result.alert.caseId,
      persistenceStatus: result.status,
    });
  },
};

const runtime = new DurableWorkerRuntime(queue, handlers, logger, {
  workerId,
  pollIntervalMs,
  leaseMs,
  heartbeatIntervalMs,
  metricsIntervalMs,
});
const shutdownController = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.log('info', 'worker_shutdown_requested', { signal, workerId });
    shutdownController.abort(signal);
  });
}

try {
  await runtime.run(shutdownController.signal);
} finally {
  await pool.end();
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}
