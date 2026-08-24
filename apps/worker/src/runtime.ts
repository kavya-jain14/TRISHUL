import {
  LeaseLostError,
  type OutboxClaim,
  type OutboxJobType,
  type OutboxMetrics,
} from '@trishul/database';
import type { StructuredLogger } from './logger.js';

export interface JobHandlerContext {
  signal: AbortSignal;
  heartbeat(): Promise<void>;
}

export type JobHandler = (payload: unknown, context: JobHandlerContext) => Promise<void>;
export type WorkerResult =
  'PROCESSED' | 'IDLE' | 'RETRY_SCHEDULED' | 'DEAD_LETTERED' | 'LEASE_LOST';

export interface WorkerQueue {
  claimNext(
    type: OutboxJobType,
    workerId: string,
    now: string,
    leaseMs: number,
  ): Promise<OutboxClaim | null>;
  heartbeat(claim: OutboxClaim, now: string, leaseMs: number): Promise<OutboxClaim>;
  succeed(claim: OutboxClaim, completedAt: string): Promise<void>;
  fail(
    claim: OutboxClaim,
    attemptedAt: string,
    errorMessage: string,
  ): Promise<'RETRY_SCHEDULED' | 'DEAD_LETTERED'>;
  metrics(now: string): Promise<OutboxMetrics>;
}

export interface WorkerRuntimeConfig {
  workerId: string;
  pollIntervalMs: number;
  leaseMs: number;
  heartbeatIntervalMs: number;
  metricsIntervalMs: number;
}

export class DurableWorkerRuntime {
  private readonly jobTypes: OutboxJobType[];

  constructor(
    private readonly queue: WorkerQueue,
    private readonly handlers: Partial<Record<OutboxJobType, JobHandler>>,
    private readonly logger: StructuredLogger,
    private readonly config: WorkerRuntimeConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (config.heartbeatIntervalMs >= config.leaseMs)
      throw new Error('WORKER_HEARTBEAT_MS must be lower than WORKER_LEASE_MS.');
    this.jobTypes = Object.keys(handlers) as OutboxJobType[];
    if (this.jobTypes.length === 0)
      throw new Error('At least one durable worker handler is required.');
  }

  async processOne(type: OutboxJobType): Promise<WorkerResult> {
    const claimed = await this.queue.claimNext(
      type,
      this.config.workerId,
      this.clock().toISOString(),
      this.config.leaseMs,
    );
    if (!claimed) return 'IDLE';
    let claim: OutboxClaim = claimed;
    const handler = this.handlers[type];
    if (!handler) throw new Error(`No handler registered for ${type}.`);

    const abortController = new AbortController();
    let heartbeatError: unknown;
    let heartbeatChain = Promise.resolve();
    const heartbeat = async () => {
      claim = await this.queue.heartbeat(claim, this.clock().toISOString(), this.config.leaseMs);
    };
    const timer = setInterval(() => {
      heartbeatChain = heartbeatChain.then(heartbeat).catch((error: unknown) => {
        heartbeatError = error;
        abortController.abort(error);
      });
    }, this.config.heartbeatIntervalMs);
    timer.unref();

    this.logger.log('info', 'outbox_job_claimed', {
      jobId: claim.jobId,
      jobType: claim.type,
      workerId: this.config.workerId,
      lockToken: claim.lockToken,
    });

    try {
      await handler(claim.payload, { signal: abortController.signal, heartbeat });
      clearInterval(timer);
      await heartbeatChain;
      if (heartbeatError) throw heartbeatError;
      await this.queue.succeed(claim, this.clock().toISOString());
      this.logger.log('info', 'outbox_job_completed', {
        jobId: claim.jobId,
        jobType: claim.type,
        workerId: this.config.workerId,
      });
      return 'PROCESSED';
    } catch (error) {
      clearInterval(timer);
      await heartbeatChain;
      if (error instanceof LeaseLostError || heartbeatError) {
        this.logger.log('warn', 'outbox_job_lease_lost', {
          jobId: claim.jobId,
          jobType: claim.type,
          workerId: this.config.workerId,
        });
        return 'LEASE_LOST';
      }
      const message = error instanceof Error ? error.message : 'Unknown worker error';
      try {
        const outcome = await this.queue.fail(claim, this.clock().toISOString(), message);
        this.logger.log(outcome === 'DEAD_LETTERED' ? 'error' : 'warn', 'outbox_job_failed', {
          jobId: claim.jobId,
          jobType: claim.type,
          workerId: this.config.workerId,
          outcome,
          error: message,
        });
        return outcome;
      } catch (failure) {
        if (failure instanceof LeaseLostError) return 'LEASE_LOST';
        throw failure;
      }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log('info', 'worker_runtime_started', {
      workerId: this.config.workerId,
      jobTypes: this.jobTypes,
      leaseMs: this.config.leaseMs,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      metricsIntervalMs: this.config.metricsIntervalMs,
    });
    let metricsChain = Promise.resolve();
    const metricsTimer = setInterval(() => {
      metricsChain = metricsChain.then(async () => {
        try {
          const metrics = await this.queue.metrics(this.clock().toISOString());
          this.logger.log('info', 'worker_queue_metrics', {
            workerId: this.config.workerId,
            ...metrics,
          });
        } catch (error) {
          this.logger.log('error', 'worker_queue_metrics_failed', {
            workerId: this.config.workerId,
            error: error instanceof Error ? error.message : 'Unknown metrics error',
          });
        }
      });
    }, this.config.metricsIntervalMs);
    metricsTimer.unref();
    try {
      while (!signal.aborted) {
        let processed = false;
        for (const type of this.jobTypes) {
          if (signal.aborted) break;
          if ((await this.processOne(type)) !== 'IDLE') processed = true;
        }
        if (!processed && !signal.aborted) await abortableDelay(this.config.pollIntervalMs, signal);
      }
    } finally {
      clearInterval(metricsTimer);
      await metricsChain;
      this.logger.log('info', 'worker_runtime_stopped', { workerId: this.config.workerId });
    }
  }
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
