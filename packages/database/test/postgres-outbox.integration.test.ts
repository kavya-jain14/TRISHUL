import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, test } from 'vitest';
import { PostgresAlertRepository } from '../src/alerts.js';
import { CaseActionConflictError, PostgresCaseActionRepository } from '../src/case-actions.js';
import { LeaseLostError, PostgresOutboxRepository } from '../src/outbox.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgresOutboxRepository integration', () => {
  test('fences an expired claimant and keeps execution policy idempotent', async () => {
    const { adminPool, pool, schema } = await isolatedDatabase(databaseUrl!);
    try {
      const repository = new PostgresOutboxRepository(pool);
      const input = {
        type: 'ALERT_DISPATCH' as const,
        payload: { caseId: 'case-lease-test', severity: 'HIGH' },
        idempotencyKey: 'alert:case-lease-test',
        createdAt: '2026-08-24T10:00:00.000Z',
        maxAttempts: 3,
      };
      expect((await repository.enqueue(input)).status).toBe('ENQUEUED');
      expect((await repository.enqueue(input)).status).toBe('IDEMPOTENT_REPLAY');
      await expect(repository.enqueue({ ...input, maxAttempts: 4 })).rejects.toThrow(
        /execution policy/,
      );

      const workerA = await repository.claimNext(
        'ALERT_DISPATCH',
        'worker-a',
        '2026-08-24T10:00:00.000Z',
        1_000,
      );
      expect(workerA).not.toBeNull();
      const workerB = await repository.claimNext(
        'ALERT_DISPATCH',
        'worker-b',
        '2026-08-24T10:00:02.000Z',
        2_000,
      );
      expect(workerB).not.toBeNull();
      expect(workerB?.lockToken).not.toBe(workerA?.lockToken);

      await expect(repository.succeed(workerA!, '2026-08-24T10:00:02.100Z')).rejects.toBeInstanceOf(
        LeaseLostError,
      );
      const heartbeated = await repository.heartbeat(workerB!, '2026-08-24T10:00:02.200Z', 2_000);
      await repository.succeed(heartbeated, '2026-08-24T10:00:03.000Z');
      expect((await repository.metrics('2026-08-24T10:00:03.000Z')).counts.COMPLETED).toBe(1);
    } finally {
      await cleanup(adminPool, pool, schema);
    }
  });

  test('dead-letters repeated failures and resets attempts when replayed', async () => {
    const { adminPool, pool, schema } = await isolatedDatabase(databaseUrl!);
    try {
      const repository = new PostgresOutboxRepository(pool);
      await repository.enqueue({
        type: 'EVIDENCE_ANCHOR',
        payload: { evidenceId: 'evidence-dead-letter-test' },
        idempotencyKey: 'anchor:evidence-dead-letter-test',
        createdAt: '2026-08-24T11:00:00.000Z',
        maxAttempts: 2,
      });
      const first = await repository.claimNext(
        'EVIDENCE_ANCHOR',
        'worker-a',
        '2026-08-24T11:00:00.000Z',
        5_000,
      );
      expect(await repository.fail(first!, '2026-08-24T11:00:00.100Z', 'temporary')).toBe(
        'RETRY_SCHEDULED',
      );
      const second = await repository.claimNext(
        'EVIDENCE_ANCHOR',
        'worker-a',
        '2026-08-24T11:00:02.000Z',
        5_000,
      );
      expect(await repository.fail(second!, '2026-08-24T11:00:02.100Z', 'permanent')).toBe(
        'DEAD_LETTERED',
      );
      const deadLetters = await repository.listOpenDeadLetters();
      expect(deadLetters).toHaveLength(1);
      await repository.replayDeadLetter(
        deadLetters[0]!.deadLetterId,
        'integration-reviewer',
        '2026-08-24T11:00:03.000Z',
      );
      const replayed = await repository.claimNext(
        'EVIDENCE_ANCHOR',
        'worker-b',
        '2026-08-24T11:00:03.000Z',
        5_000,
      );
      expect(await repository.fail(replayed!, '2026-08-24T11:00:03.100Z', 'retry')).toBe(
        'RETRY_SCHEDULED',
      );
    } finally {
      await cleanup(adminPool, pool, schema);
    }
  });

  test('persists and acknowledges an alert idempotently against a canonical case', async () => {
    const { adminPool, pool, schema } = await isolatedDatabase(databaseUrl!);
    try {
      await pool.query(
        `INSERT INTO cases (external_case_id, state, original_transaction_ref)
         VALUES ($1, 'REPORTED', $2)`,
        ['case-alert-test', 'rrn-alert-test'],
      );
      const repository = new PostgresAlertRepository(pool);
      const payload = {
        alertId: 'alert-test-1',
        caseId: 'case-alert-test',
        severity: 'HIGH' as const,
        kind: 'TRACE_RISK' as const,
        title: 'Rapid dispersal detected',
        message: 'The traced transaction dispersed across multiple beneficiary accounts.',
        sourceUrls: ['https://example.test/provider-event/1'],
        createdAt: '2026-08-24T12:00:00.000Z',
      };
      expect((await repository.persist(payload)).status).toBe('CREATED');
      expect((await repository.persist(payload)).status).toBe('IDEMPOTENT_REPLAY');
      await expect(repository.persist({ ...payload, severity: 'CRITICAL' })).rejects.toThrow(
        /different content/,
      );
      expect(
        (await repository.acknowledge('alert-test-1', '2026-08-24T12:01:00.000Z')).acknowledgedAt,
      ).toBe('2026-08-24T12:01:00.000Z');
      expect(await repository.listForCase('case-alert-test')).toHaveLength(1);
    } finally {
      await cleanup(adminPool, pool, schema);
    }
  });

  test('persists a case action and its durable event atomically', async () => {
    const { adminPool, pool, schema } = await isolatedDatabase(databaseUrl!);
    try {
      await pool.query(
        `INSERT INTO cases (external_case_id, state, original_transaction_ref)
         VALUES ($1, 'REPORTED', $2)`,
        ['case-action-test', 'rrn-action-test'],
      );
      const repository = new PostgresCaseActionRepository(pool);
      const action = {
        actionId: 'action-pg-1',
        caseId: 'case-action-test',
        action: 'ALERT_LEA' as const,
        actorRef: 'analyst-pg',
        actorRole: 'SUPERVISOR' as const,
        purpose: 'FRAUD_INVESTIGATION' as const,
        rationale: 'Evidence-backed escalation to law enforcement.',
        evidenceAnchorIds: ['anchor:action-pg-1'],
        sourceUrls: ['https://example.test/evidence/action-pg-1'],
        occurredAt: '2026-08-24T13:00:00.000Z',
        recordedAt: '2026-08-24T13:00:01.000Z',
      };
      const input = { action, idempotencyKey: 'action-pg-key', requestHash: 'a'.repeat(64) };

      expect((await repository.record(input)).status).toBe('CREATED');
      expect((await repository.record(input)).status).toBe('IDEMPOTENT_REPLAY');
      await expect(
        repository.record({ ...input, requestHash: 'b'.repeat(64) }),
      ).rejects.toBeInstanceOf(CaseActionConflictError);
      expect(await repository.listForCase(action.caseId)).toEqual([action]);
      const queued = await pool.query(
        `SELECT job_type, payload, idempotency_key FROM outbox_jobs WHERE job_type = 'CASE_ACTION_EVENT'`,
      );
      expect(queued.rows).toEqual([
        expect.objectContaining({
          job_type: 'CASE_ACTION_EVENT',
          idempotency_key: 'case-action:action-pg-1',
          payload: { action },
        }),
      ]);
    } finally {
      await cleanup(adminPool, pool, schema);
    }
  });

  test('rolls back the case action when its outbox enqueue fails', async () => {
    const { adminPool, pool, schema } = await isolatedDatabase(databaseUrl!);
    try {
      await pool.query(
        `INSERT INTO cases (external_case_id, state, original_transaction_ref)
         VALUES ($1, 'REPORTED', $2)`,
        ['case-action-rollback', 'rrn-action-rollback'],
      );
      await pool.query(`
        CREATE FUNCTION reject_case_action_event() RETURNS trigger AS $$
        BEGIN
          IF NEW.job_type = 'CASE_ACTION_EVENT' THEN
            RAISE EXCEPTION 'forced outbox failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_case_action_event_trigger
          BEFORE INSERT ON outbox_jobs
          FOR EACH ROW EXECUTE FUNCTION reject_case_action_event();
      `);
      const repository = new PostgresCaseActionRepository(pool);
      const action = {
        actionId: 'action-pg-rollback',
        caseId: 'case-action-rollback',
        action: 'ALERT_BANK' as const,
        actorRef: 'investigator:rollback',
        actorRole: 'INVESTIGATOR' as const,
        purpose: 'FRAUD_INVESTIGATION' as const,
        rationale: 'Verified evidence requires provider review.',
        evidenceAnchorIds: ['anchor:rollback'],
        sourceUrls: [],
        occurredAt: '2026-08-24T13:10:00.000Z',
        recordedAt: '2026-08-24T13:10:01.000Z',
      };

      await expect(
        repository.record({
          action,
          idempotencyKey: 'action-pg-rollback-key',
          requestHash: 'c'.repeat(64),
        }),
      ).rejects.toThrow('forced outbox failure');
      expect((await pool.query(`SELECT action_id FROM case_actions`)).rows).toEqual([]);
    } finally {
      await cleanup(adminPool, pool, schema);
    }
  });
});

async function isolatedDatabase(connectionString: string) {
  const schema = `fuzail_outbox_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString, max: 1 });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
  for (const migrationFile of ['001_core.sql', '004_durable_outbox.sql', '005_case_actions.sql']) {
    const migration = await readFile(
      new URL(`../migrations/${migrationFile}`, import.meta.url),
      'utf8',
    );
    await pool.query(migration);
  }
  return { adminPool, pool, schema };
}

async function cleanup(adminPool: Pool, pool: Pool, schema: string) {
  await pool.end();
  await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await adminPool.end();
}
