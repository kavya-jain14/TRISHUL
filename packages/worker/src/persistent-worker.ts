import { alertJobPayloadSchema, type AlertJobPayload } from "../../contracts/src/case.ts";
import type {
  PersistentJobType,
  PersistentOutboxJob,
  QueueHealth,
  QueueMetrics
} from "../../database/src/outbox.ts";
import type { StructuredLogger } from "./observability.ts";

export type PersistentQueue = {
  claimNext(type: PersistentJobType, workerId: string, now: string, leaseMs?: number): Promise<PersistentOutboxJob | undefined>;
  succeed(jobId: string, workerId: string, attemptedAt: string): Promise<void>;
  fail(job: PersistentOutboxJob, workerId: string, attemptedAt: string, error: string): Promise<"RETRY_SCHEDULED" | "DEAD_LETTERED">;
  metrics(now: string): Promise<QueueMetrics>;
  health(now: string): Promise<QueueHealth>;
};

export type JobHandler = (payload: unknown, job: PersistentOutboxJob) => Promise<void>;
export type WorkerResult = "PROCESSED" | "IDLE" | "RETRY_SCHEDULED" | "DEAD_LETTERED";

export class PersistentOutboxWorker {
  readonly #queue: PersistentQueue;
  readonly #workerId: string;
  readonly #logger: StructuredLogger;
  readonly #handlers: Partial<Record<PersistentJobType, JobHandler>>;

  constructor(input: {
    queue: PersistentQueue;
    workerId: string;
    logger: StructuredLogger;
    handlers: Partial<Record<PersistentJobType, JobHandler>>;
  }) {
    this.#queue = input.queue;
    this.#workerId = input.workerId;
    this.#logger = input.logger;
    this.#handlers = input.handlers;
  }

  async processOne(type: PersistentJobType, now: string): Promise<WorkerResult> {
    const job = await this.#queue.claimNext(type, this.#workerId, now);
    if (job === undefined) return "IDLE";
    this.#logger.log("INFO", "outbox_job_claimed", { jobId: job.jobId, jobType: job.type, workerId: this.#workerId });

    try {
      const handler = this.#handlers[job.type];
      if (handler === undefined) throw new Error(`No handler is registered for ${job.type}.`);
      await handler(job.payload, job);
      await this.#queue.succeed(job.jobId, this.#workerId, now);
      this.#logger.log("INFO", "outbox_job_completed", { jobId: job.jobId, jobType: job.type, workerId: this.#workerId });
      return "PROCESSED";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      const result = await this.#queue.fail(job, this.#workerId, now, message);
      this.#logger.log(result === "DEAD_LETTERED" ? "ERROR" : "WARN", "outbox_job_failed", {
        jobId: job.jobId,
        jobType: job.type,
        workerId: this.#workerId,
        outcome: result,
        error: message
      });
      return result;
    }
  }

  metrics(now: string): Promise<QueueMetrics> {
    return this.#queue.metrics(now);
  }

  health(now: string): Promise<QueueHealth> {
    return this.#queue.health(now);
  }
}

export type AlertWriter = {
  persist(alert: AlertJobPayload): Promise<unknown>;
};

export class AlertWorker {
  readonly #alerts: AlertWriter;

  constructor(alerts: AlertWriter) {
    this.#alerts = alerts;
  }

  async handle(rawPayload: unknown): Promise<void> {
    await this.#alerts.persist(alertJobPayloadSchema.parse(rawPayload));
  }
}
