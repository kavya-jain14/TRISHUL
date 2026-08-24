import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';

export const OUTBOX_JOB_TYPES = [
  'TRACE_GRAPH_EXPANSION',
  'EXPOSURE_RECOMPUTE',
  'RISK_REASSESSMENT',
  'FORECAST_REFRESH',
  'ALERT_DISPATCH',
  'EVIDENCE_ANCHOR',
] as const;

export type OutboxJobType = (typeof OUTBOX_JOB_TYPES)[number];
export type OutboxJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface OutboxJob {
  jobId: string;
  type: OutboxJobType;
  payload: unknown;
  idempotencyKey: string;
  status: OutboxJobStatus;
  availableAt: string;
  createdAt: string;
  maxAttempts: number;
  failureCount: number;
}

export interface OutboxClaim extends OutboxJob {
  status: 'PROCESSING';
  workerId: string;
  lockToken: string;
  leaseExpiresAt: string;
}

export interface OutboxMetrics {
  counts: Record<OutboxJobStatus, number>;
  openDeadLetters: number;
  oldestPendingAgeMs: number | null;
}

export interface DeadLetterJob {
  deadLetterId: string;
  jobId: string;
  type: OutboxJobType;
  payload: unknown;
  idempotencyKey: string;
  failureReason: string;
  failedAt: string;
}

interface JobRow {
  jobId: string;
  jobType: OutboxJobType;
  payload: unknown;
  idempotencyKey: string;
  status: OutboxJobStatus;
  availableAt: Date | string;
  createdAt: Date | string;
  maxAttempts: number;
  failureCount: number;
  lockedBy: string | null;
  lockToken: string | null;
  leaseExpiresAt: Date | string | null;
}

const JOB_COLUMNS = `job_id AS "jobId", job_type AS "jobType", payload,
  idempotency_key AS "idempotencyKey", status, available_at AS "availableAt",
  created_at AS "createdAt", max_attempts AS "maxAttempts",
  failure_count AS "failureCount", locked_by AS "lockedBy",
  lock_token AS "lockToken", lease_expires_at AS "leaseExpiresAt"`;

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lease ownership was lost for outbox job ${jobId}.`);
  }
}

export class PostgresOutboxRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: {
    type: OutboxJobType;
    payload: unknown;
    idempotencyKey: string;
    createdAt: string;
    maxAttempts?: number;
  }): Promise<{ status: 'ENQUEUED' | 'IDEMPOTENT_REPLAY'; job: OutboxJob }> {
    const maxAttempts = input.maxAttempts ?? 3;
    const inserted = await this.pool.query<JobRow>(
      `INSERT INTO outbox_jobs
        (job_id, job_type, payload, idempotency_key, status, available_at, created_at, max_attempts)
       VALUES ($1, $2, $3::jsonb, $4, 'PENDING', $5, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ${JOB_COLUMNS}`,
      [
        randomUUID(),
        input.type,
        JSON.stringify(input.payload),
        input.idempotencyKey,
        input.createdAt,
        maxAttempts,
      ],
    );
    const created = inserted.rows[0];
    if (created) return { status: 'ENQUEUED', job: mapJob(created) };

    const existingResult = await this.pool.query<JobRow>(
      `SELECT ${JOB_COLUMNS} FROM outbox_jobs WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (
      !existing ||
      existing.jobType !== input.type ||
      existing.maxAttempts !== maxAttempts ||
      !isDeepStrictEqual(existing.payload, input.payload)
    ) {
      throw new Error(
        `Outbox idempotency key ${input.idempotencyKey} was reused with different input or execution policy.`,
      );
    }
    return { status: 'IDEMPOTENT_REPLAY', job: mapJob(existing) };
  }

  async claimNext(
    type: OutboxJobType,
    workerId: string,
    now: string,
    leaseMs: number,
  ): Promise<OutboxClaim | null> {
    const lockToken = randomUUID();
    const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    const result = await this.pool.query<JobRow>(
      `WITH candidate AS (
         SELECT job_id FROM outbox_jobs
         WHERE job_type = $1
           AND ((status = 'PENDING' AND available_at <= $3)
             OR (status = 'PROCESSING' AND lease_expires_at <= $3))
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE outbox_jobs AS job
       SET status = 'PROCESSING', locked_by = $2, lock_token = $4,
         locked_at = $3, lease_expires_at = $5
       FROM candidate WHERE job.job_id = candidate.job_id
       RETURNING job.job_id AS "jobId", job.job_type AS "jobType", job.payload,
         job.idempotency_key AS "idempotencyKey", job.status,
         job.available_at AS "availableAt", job.created_at AS "createdAt",
         job.max_attempts AS "maxAttempts", job.failure_count AS "failureCount",
         job.locked_by AS "lockedBy", job.lock_token AS "lockToken",
         job.lease_expires_at AS "leaseExpiresAt"`,
      [type, workerId, now, lockToken, leaseExpiresAt],
    );
    const row = result.rows[0];
    return row ? mapClaim(row) : null;
  }

  async heartbeat(claim: OutboxClaim, now: string, leaseMs: number): Promise<OutboxClaim> {
    const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    const result = await this.pool.query<JobRow>(
      `UPDATE outbox_jobs SET lease_expires_at = $5
       WHERE job_id = $1 AND status = 'PROCESSING' AND locked_by = $2
         AND lock_token = $3 AND lease_expires_at > $4
       RETURNING ${JOB_COLUMNS}`,
      [claim.jobId, claim.workerId, claim.lockToken, now, leaseExpiresAt],
    );
    const row = result.rows[0];
    if (!row) throw new LeaseLostError(claim.jobId);
    return mapClaim(row);
  }

  async succeed(claim: OutboxClaim, completedAt: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE outbox_jobs SET status = 'COMPLETED', completed_at = $4,
          locked_by = NULL, lock_token = NULL, locked_at = NULL, lease_expires_at = NULL,
          last_error = NULL
         WHERE job_id = $1 AND status = 'PROCESSING' AND locked_by = $2
           AND lock_token = $3 AND lease_expires_at > $4`,
        [claim.jobId, claim.workerId, claim.lockToken, completedAt],
      );
      if (updated.rowCount !== 1) throw new LeaseLostError(claim.jobId);
      await client.query(
        `INSERT INTO outbox_attempts (attempt_id, job_id, lock_token, attempted_at, outcome)
         VALUES ($1, $2, $3, $4, 'SUCCEEDED')`,
        [randomUUID(), claim.jobId, claim.lockToken, completedAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(
    claim: OutboxClaim,
    attemptedAt: string,
    errorMessage: string,
  ): Promise<'RETRY_SCHEDULED' | 'DEAD_LETTERED'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await this.lockOwnedClaim(client, claim, attemptedAt);
      const failureCount = owned.failureCount + 1;
      await client.query(
        `INSERT INTO outbox_attempts
          (attempt_id, job_id, lock_token, attempted_at, outcome, error_message)
         VALUES ($1, $2, $3, $4, 'FAILED', $5)`,
        [randomUUID(), claim.jobId, claim.lockToken, attemptedAt, errorMessage],
      );

      if (failureCount >= owned.maxAttempts) {
        await client.query(
          `UPDATE outbox_jobs SET status = 'FAILED', failure_count = $4, last_error = $5,
            locked_by = NULL, lock_token = NULL, locked_at = NULL, lease_expires_at = NULL
           WHERE job_id = $1 AND locked_by = $2 AND lock_token = $3`,
          [claim.jobId, claim.workerId, claim.lockToken, failureCount, errorMessage],
        );
        await client.query(
          `INSERT INTO dead_letter_jobs
            (dead_letter_id, job_id, job_type, payload, idempotency_key, failure_reason, failed_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [
            randomUUID(),
            claim.jobId,
            claim.type,
            JSON.stringify(claim.payload),
            claim.idempotencyKey,
            errorMessage,
            attemptedAt,
          ],
        );
        await client.query('COMMIT');
        return 'DEAD_LETTERED';
      }

      const availableAt = new Date(
        Date.parse(attemptedAt) + 1_000 * 2 ** (failureCount - 1),
      ).toISOString();
      await client.query(
        `UPDATE outbox_jobs SET status = 'PENDING', failure_count = $4,
          available_at = $5, last_error = $6,
          locked_by = NULL, lock_token = NULL, locked_at = NULL, lease_expires_at = NULL
         WHERE job_id = $1 AND locked_by = $2 AND lock_token = $3`,
        [claim.jobId, claim.workerId, claim.lockToken, failureCount, availableAt, errorMessage],
      );
      await client.query('COMMIT');
      return 'RETRY_SCHEDULED';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listOpenDeadLetters(limit = 100): Promise<readonly DeadLetterJob[]> {
    const result = await this.pool.query<{
      deadLetterId: string;
      jobId: string;
      jobType: OutboxJobType;
      payload: unknown;
      idempotencyKey: string;
      failureReason: string;
      failedAt: Date | string;
    }>(
      `SELECT dead_letter_id AS "deadLetterId", job_id AS "jobId", job_type AS "jobType",
        payload, idempotency_key AS "idempotencyKey", failure_reason AS "failureReason",
        failed_at AS "failedAt"
       FROM dead_letter_jobs WHERE replayed_at IS NULL ORDER BY failed_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      deadLetterId: row.deadLetterId,
      jobId: row.jobId,
      type: row.jobType,
      payload: row.payload,
      idempotencyKey: row.idempotencyKey,
      failureReason: row.failureReason,
      failedAt: iso(row.failedAt),
    }));
  }

  async replayDeadLetter(
    deadLetterId: string,
    replayedBy: string,
    now: string,
  ): Promise<OutboxJob> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const deadLetter = await client.query<{ jobId: string }>(
        `SELECT job_id AS "jobId" FROM dead_letter_jobs
         WHERE dead_letter_id = $1 AND replayed_at IS NULL FOR UPDATE`,
        [deadLetterId],
      );
      const row = deadLetter.rows[0];
      if (!row) throw new Error(`Open dead letter ${deadLetterId} was not found.`);
      const updated = await client.query<JobRow>(
        `UPDATE outbox_jobs SET status = 'PENDING', available_at = $2,
          completed_at = NULL, failure_count = 0, last_error = NULL,
          locked_by = NULL, lock_token = NULL, locked_at = NULL, lease_expires_at = NULL
         WHERE job_id = $1 RETURNING ${JOB_COLUMNS}`,
        [row.jobId, now],
      );
      await client.query(
        `UPDATE dead_letter_jobs SET replayed_at = $2, replayed_by = $3
         WHERE dead_letter_id = $1`,
        [deadLetterId, now, replayedBy],
      );
      await client.query('COMMIT');
      const job = updated.rows[0];
      if (!job) throw new Error(`Outbox job ${row.jobId} was not found.`);
      return mapJob(job);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async metrics(now: string): Promise<OutboxMetrics> {
    const [countsResult, deadResult, ageResult] = await Promise.all([
      this.pool.query<{ status: OutboxJobStatus; count: number }>(
        `SELECT status, count(*)::integer AS count FROM outbox_jobs GROUP BY status`,
      ),
      this.pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM dead_letter_jobs WHERE replayed_at IS NULL`,
      ),
      this.pool.query<{ ageMs: number | null }>(
        `SELECT CASE WHEN min(created_at) IS NULL THEN NULL
          ELSE floor(extract(epoch FROM ($1::timestamptz - min(created_at))) * 1000)::bigint END AS "ageMs"
         FROM outbox_jobs WHERE status = 'PENDING'`,
        [now],
      ),
    ]);
    const counts: Record<OutboxJobStatus, number> = {
      PENDING: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };
    for (const row of countsResult.rows) counts[row.status] = Number(row.count);
    const rawAge = ageResult.rows[0]?.ageMs ?? null;
    return {
      counts,
      openDeadLetters: Number(deadResult.rows[0]?.count ?? 0),
      oldestPendingAgeMs: rawAge === null ? null : Number(rawAge),
    };
  }

  private async lockOwnedClaim(
    client: PoolClient,
    claim: OutboxClaim,
    now: string,
  ): Promise<{ failureCount: number; maxAttempts: number }> {
    const result = await client.query<{ failureCount: number; maxAttempts: number }>(
      `SELECT failure_count AS "failureCount", max_attempts AS "maxAttempts"
       FROM outbox_jobs WHERE job_id = $1 AND status = 'PROCESSING'
         AND locked_by = $2 AND lock_token = $3 AND lease_expires_at > $4 FOR UPDATE`,
      [claim.jobId, claim.workerId, claim.lockToken, now],
    );
    const row = result.rows[0];
    if (!row) throw new LeaseLostError(claim.jobId);
    return row;
  }
}

function mapJob(row: JobRow): OutboxJob {
  return {
    jobId: row.jobId,
    type: row.jobType,
    payload: row.payload,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    availableAt: iso(row.availableAt),
    createdAt: iso(row.createdAt),
    maxAttempts: row.maxAttempts,
    failureCount: row.failureCount,
  };
}

function mapClaim(row: JobRow): OutboxClaim {
  if (!row.lockedBy || !row.lockToken || !row.leaseExpiresAt || row.status !== 'PROCESSING') {
    throw new Error(`Claimed outbox job ${row.jobId} has incomplete lease metadata.`);
  }
  return {
    ...mapJob(row),
    status: 'PROCESSING',
    workerId: row.lockedBy,
    lockToken: row.lockToken,
    leaseExpiresAt: iso(row.leaseExpiresAt),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
