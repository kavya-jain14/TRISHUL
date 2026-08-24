import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type PersistentJobType = "TRACE_REFRESH" | "EVIDENCE_ANCHOR" | "ALERT";
export type PersistentJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export type PersistentOutboxJob = {
  jobId: string;
  type: PersistentJobType;
  payload: unknown;
  idempotencyKey: string;
  status: PersistentJobStatus;
  availableAt: string;
  createdAt: string;
  lockedBy: string | null;
  leaseExpiresAt: string | null;
  maxAttempts: number;
};

export type QueueMetrics = {
  counts: Record<PersistentJobStatus, number>;
  openDeadLetters: number;
  oldestPendingAgeMs: number | null;
};

export type QueueHealth = {
  status: "HEALTHY" | "DEGRADED";
  databaseReachable: boolean;
  metrics?: QueueMetrics;
  checkedAt: string;
  reason?: string;
};

export type DeadLetterJob = {
  deadLetterId: string;
  jobId: string;
  type: PersistentJobType;
  payload: unknown;
  idempotencyKey: string;
  failureReason: string;
  failedAt: string;
};

type JobRow = {
  jobId: string;
  jobType: PersistentJobType;
  payload: unknown;
  idempotencyKey: string;
  status: PersistentJobStatus;
  availableAt: string | Date;
  createdAt: string | Date;
  lockedBy: string | null;
  leaseExpiresAt: string | Date | null;
  maxAttempts: number;
};

const RETURNING_JOB = `RETURNING job_id AS "jobId", job_type AS "jobType", payload,
  idempotency_key AS "idempotencyKey", status, available_at AS "availableAt",
  created_at AS "createdAt", locked_by AS "lockedBy", lease_expires_at AS "leaseExpiresAt",
  max_attempts AS "maxAttempts"`;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapJob(row: JobRow): PersistentOutboxJob {
  return {
    jobId: row.jobId,
    type: row.jobType,
    payload: row.payload,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    availableAt: iso(row.availableAt),
    createdAt: iso(row.createdAt),
    lockedBy: row.lockedBy,
    leaseExpiresAt: row.leaseExpiresAt === null ? null : iso(row.leaseExpiresAt),
    maxAttempts: row.maxAttempts
  };
}

export class PostgresOutboxRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async enqueue(input: {
    type: PersistentJobType;
    payload: unknown;
    idempotencyKey: string;
    createdAt: string;
    maxAttempts?: number;
  }): Promise<{ status: "ENQUEUED" | "IDEMPOTENT_REPLAY"; job: PersistentOutboxJob }> {
    const result = await this.#pool.query<JobRow>(
      `INSERT INTO outbox_jobs
        (job_id, job_type, payload, idempotency_key, status, available_at, created_at, max_attempts)
       VALUES ($1, $2, $3::jsonb, $4, 'PENDING', $5, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING ${RETURNING_JOB}`,
      [randomUUID(), input.type, JSON.stringify(input.payload), input.idempotencyKey, input.createdAt, input.maxAttempts ?? 3]
    );
    const inserted = result.rows[0];
    if (inserted !== undefined) return { status: "ENQUEUED", job: mapJob(inserted) };

    const existing = await this.#pool.query<JobRow>(
      `SELECT job_id AS "jobId", job_type AS "jobType", payload,
        idempotency_key AS "idempotencyKey", status, available_at AS "availableAt",
        created_at AS "createdAt", locked_by AS "lockedBy", lease_expires_at AS "leaseExpiresAt",
        max_attempts AS "maxAttempts" FROM outbox_jobs WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    const row = existing.rows[0];
    if (row === undefined || row.jobType !== input.type || !isDeepStrictEqual(row.payload, input.payload)) {
      throw new Error(`Outbox idempotency key ${input.idempotencyKey} was reused with a different job.`);
    }
    return { status: "IDEMPOTENT_REPLAY", job: mapJob(row) };
  }

  async claimNext(type: PersistentJobType, workerId: string, now: string, leaseMs = 30_000): Promise<PersistentOutboxJob | undefined> {
    const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    const result = await this.#pool.query<JobRow>(
      `WITH candidate AS (
         SELECT job_id FROM outbox_jobs
         WHERE job_type = $1
           AND ((status = 'PENDING' AND available_at <= $3)
             OR (status = 'PROCESSING' AND lease_expires_at <= $3))
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE outbox_jobs AS job
       SET status = 'PROCESSING', locked_by = $2, locked_at = $3, lease_expires_at = $4
       FROM candidate WHERE job.job_id = candidate.job_id ${RETURNING_JOB}`,
      [type, workerId, now, leaseExpiresAt]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapJob(row);
  }

  async succeed(jobId: string, workerId: string, attemptedAt: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE outbox_jobs SET status = 'COMPLETED', completed_at = $3,
          locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, last_error = NULL
         WHERE job_id = $1 AND status = 'PROCESSING' AND locked_by = $2`,
        [jobId, workerId, attemptedAt]
      );
      if (updated.rowCount !== 1) throw new Error(`Worker ${workerId} does not own processing job ${jobId}.`);
      await client.query(
        `INSERT INTO outbox_attempts (attempt_id, job_id, attempted_at, outcome)
         VALUES ($1, $2, $3, 'SUCCEEDED')`,
        [randomUUID(), jobId, attemptedAt]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(job: PersistentOutboxJob, workerId: string, attemptedAt: string, error: string): Promise<"RETRY_SCHEDULED" | "DEAD_LETTERED"> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const ownedJob = await this.#lockOwnedJob(client, job.jobId, workerId);
      const failureCount = ownedJob.failureCount + 1;
      await client.query(
        `INSERT INTO outbox_attempts (attempt_id, job_id, attempted_at, outcome, error_message)
         VALUES ($1, $2, $3, 'FAILED', $4)`,
        [randomUUID(), job.jobId, attemptedAt, error]
      );

      if (failureCount >= ownedJob.maxAttempts) {
        await client.query(
          `UPDATE outbox_jobs SET status = 'FAILED', last_error = $3, failure_count = $4,
            locked_by = NULL, locked_at = NULL, lease_expires_at = NULL
           WHERE job_id = $1 AND locked_by = $2`,
          [job.jobId, workerId, error, failureCount]
        );
        await client.query(
          `INSERT INTO dead_letter_jobs
            (dead_letter_id, job_id, job_type, payload, idempotency_key, failure_reason, failed_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [randomUUID(), job.jobId, job.type, JSON.stringify(job.payload), job.idempotencyKey, error, attemptedAt]
        );
        await client.query("COMMIT");
        return "DEAD_LETTERED";
      }

      const availableAt = new Date(Date.parse(attemptedAt) + 1_000 * 2 ** (failureCount - 1)).toISOString();
      await client.query(
        `UPDATE outbox_jobs SET status = 'PENDING', available_at = $3, last_error = $4, failure_count = $5,
          locked_by = NULL, locked_at = NULL, lease_expires_at = NULL
         WHERE job_id = $1 AND locked_by = $2`,
        [job.jobId, workerId, availableAt, error, failureCount]
      );
      await client.query("COMMIT");
      return "RETRY_SCHEDULED";
    } catch (failure) {
      await client.query("ROLLBACK");
      throw failure;
    } finally {
      client.release();
    }
  }

  async replayDeadLetter(deadLetterId: string, replayedBy: string, now: string): Promise<PersistentOutboxJob> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const deadLetter = await client.query<{ jobId: string }>(
        `SELECT job_id AS "jobId" FROM dead_letter_jobs
         WHERE dead_letter_id = $1 AND replayed_at IS NULL FOR UPDATE`,
        [deadLetterId]
      );
      const row = deadLetter.rows[0];
      if (row === undefined) throw new Error(`Open dead letter ${deadLetterId} was not found.`);
      const updated = await client.query<JobRow>(
        `UPDATE outbox_jobs SET status = 'PENDING', available_at = $2, completed_at = NULL,
          locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, last_error = NULL,
          failure_count = 0
         WHERE job_id = $1 ${RETURNING_JOB}`,
        [row.jobId, now]
      );
      await client.query(
        `UPDATE dead_letter_jobs SET replayed_at = $2, replayed_by = $3 WHERE dead_letter_id = $1`,
        [deadLetterId, now, replayedBy]
      );
      await client.query("COMMIT");
      const job = updated.rows[0];
      if (job === undefined) throw new Error(`Dead-letter job ${row.jobId} was not found.`);
      return mapJob(job);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listOpenDeadLetters(limit = 100): Promise<readonly DeadLetterJob[]> {
    const result = await this.#pool.query<{
      deadLetterId: string;
      jobId: string;
      jobType: PersistentJobType;
      payload: unknown;
      idempotencyKey: string;
      failureReason: string;
      failedAt: string | Date;
    }>(
      `SELECT dead_letter_id AS "deadLetterId", job_id AS "jobId", job_type AS "jobType",
        payload, idempotency_key AS "idempotencyKey", failure_reason AS "failureReason",
        failed_at AS "failedAt"
       FROM dead_letter_jobs WHERE replayed_at IS NULL ORDER BY failed_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => ({
      deadLetterId: row.deadLetterId,
      jobId: row.jobId,
      type: row.jobType,
      payload: row.payload,
      idempotencyKey: row.idempotencyKey,
      failureReason: row.failureReason,
      failedAt: iso(row.failedAt)
    }));
  }

  async metrics(now: string): Promise<QueueMetrics> {
    const [countsResult, deadResult, oldestResult] = await Promise.all([
      this.#pool.query<{ status: PersistentJobStatus; count: number }>(
        `SELECT status, count(*)::integer AS count FROM outbox_jobs GROUP BY status`
      ),
      this.#pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM dead_letter_jobs WHERE replayed_at IS NULL`
      ),
      this.#pool.query<{ ageMs: number | null }>(
        `SELECT CASE WHEN min(created_at) IS NULL THEN NULL
          ELSE floor(extract(epoch FROM ($1::timestamptz - min(created_at))) * 1000)::bigint END AS "ageMs"
         FROM outbox_jobs WHERE status = 'PENDING'`,
        [now]
      )
    ]);
    const counts: Record<PersistentJobStatus, number> = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0 };
    for (const row of countsResult.rows) counts[row.status] = Number(row.count);
    const rawAge = oldestResult.rows[0]?.ageMs ?? null;
    return {
      counts,
      openDeadLetters: Number(deadResult.rows[0]?.count ?? 0),
      oldestPendingAgeMs: rawAge === null ? null : Number(rawAge)
    };
  }

  async health(now: string): Promise<QueueHealth> {
    try {
      await this.#pool.query("SELECT 1");
      const metrics = await this.metrics(now);
      return {
        status: metrics.openDeadLetters > 0 ? "DEGRADED" : "HEALTHY",
        databaseReachable: true,
        metrics,
        checkedAt: now
      };
    } catch (error) {
      return {
        status: "DEGRADED",
        databaseReachable: false,
        checkedAt: now,
        reason: error instanceof Error ? error.message : "Unknown database health error"
      };
    }
  }

  async #lockOwnedJob(client: PoolClient, jobId: string, workerId: string): Promise<{ failureCount: number; maxAttempts: number }> {
    const result = await client.query<{ failureCount: number; maxAttempts: number }>(
      `SELECT failure_count AS "failureCount", max_attempts AS "maxAttempts" FROM outbox_jobs
       WHERE job_id = $1 AND status = 'PROCESSING' AND locked_by = $2 FOR UPDATE`,
      [jobId, workerId]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Worker ${workerId} does not own processing job ${jobId}.`);
    return row;
  }
}
