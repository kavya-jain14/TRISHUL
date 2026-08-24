import { randomUUID } from "node:crypto";

export type OutboxType = "TRACE_REFRESH" | "EVIDENCE_ANCHOR";
export type OutboxStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type Attempt = { attemptedAt: string; outcome: "FAILED" | "SUCCEEDED"; error?: string };
export type OutboxJob = {
  jobId: string;
  type: OutboxType;
  payload: unknown;
  idempotencyKey: string;
  status: OutboxStatus;
  availableAt: string;
  attempts: readonly Attempt[];
  createdAt: string;
};

export class InMemoryOutbox {
  readonly #jobs: OutboxJob[] = [];
  readonly #byIdempotencyKey = new Map<string, OutboxJob>();

  enqueue(input: { type: OutboxType; payload: unknown; idempotencyKey: string; createdAt: string }): { status: "ENQUEUED" | "IDEMPOTENT_REPLAY"; job: OutboxJob } {
    const existing = this.#byIdempotencyKey.get(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.type !== input.type || JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) throw new Error(`Outbox idempotency key ${input.idempotencyKey} was reused with a different job.`);
      return { status: "IDEMPOTENT_REPLAY", job: existing };
    }
    const job: OutboxJob = { jobId: randomUUID(), type: input.type, payload: input.payload, idempotencyKey: input.idempotencyKey, status: "PENDING", availableAt: input.createdAt, attempts: [], createdAt: input.createdAt };
    this.#jobs.push(job);
    this.#byIdempotencyKey.set(job.idempotencyKey, job);
    return { status: "ENQUEUED", job };
  }

  claimNext(type: OutboxType, now: string): OutboxJob | undefined {
    const job = this.#jobs.find((item) => item.type === type && item.status === "PENDING" && item.availableAt <= now);
    if (job === undefined) return undefined;
    job.status = "PROCESSING";
    return job;
  }

  succeed(job: OutboxJob, attemptedAt: string): void {
    if (job.status !== "PROCESSING") throw new Error("Only a claimed outbox job can succeed.");
    job.status = "COMPLETED";
    job.attempts = [...job.attempts, { attemptedAt, outcome: "SUCCEEDED" }];
  }

  fail(job: OutboxJob, attemptedAt: string, error: string, maxAttempts = 3): void {
    if (job.status !== "PROCESSING") throw new Error("Only a claimed outbox job can fail.");
    const failure: Attempt = { attemptedAt, outcome: "FAILED", error };
    const attempts: readonly Attempt[] = [...job.attempts, failure];
    job.attempts = attempts;
    if (attempts.filter((attempt) => attempt.outcome === "FAILED").length >= maxAttempts) {
      job.status = "FAILED";
      return;
    }
    job.status = "PENDING";
    job.availableAt = new Date(Date.parse(attemptedAt) + 1_000 * 2 ** (attempts.length - 1)).toISOString();
  }

  list(): readonly OutboxJob[] {
    return this.#jobs.toReversed();
  }

  metrics(): Record<OutboxStatus, number> {
    return this.#jobs.reduce<Record<OutboxStatus, number>>((counts, job) => ({ ...counts, [job.status]: counts[job.status] + 1 }), { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 });
  }
}

